//! Saved recordings as Ogg Opus: about a tenth of the size of WAV.
//!
//! A recording is always made as WAV, which survives a crash mid-recording.
//! Once it is finished it can be compressed to `{id}.opus`, and everything
//! that reads a recording (playback, transcribing again) decodes it back to
//! the same 16 kHz mono samples.
use std::{
    fs,
    io::{BufReader, BufWriter, Read, Seek, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

/// What the speech engine works with, and so what recordings are stored at.
pub const SAMPLE_RATE: u32 = 16_000;
/// 20 ms of audio: the frame size Opus is tuned for.
const FRAME: usize = 320;
/// Wideband speech is transparent to a speech engine well below this.
const BITRATE: i32 = 24_000;
/// Opus counts time at 48 kHz whatever the input rate.
const GRANULE_PER_SAMPLE: u64 = 48_000 / SAMPLE_RATE as u64;
/// One Ogg page a second keeps seeking and recovery cheap.
const FRAMES_PER_PAGE: usize = 50;
const SERIAL: u32 = 0x534f_4e4f;
const MAX_PACKET: usize = 1500;

fn opus_error(error: opus::Error) -> String {
    format!("Opus error: {error}")
}

fn io_error(error: std::io::Error) -> String {
    format!("Cannot write compressed audio: {error}")
}

/// The identification header of an Ogg Opus stream (RFC 7845, section 5.1).
fn opus_head(pre_skip: u16) -> Vec<u8> {
    let mut head = Vec::with_capacity(19);
    head.extend_from_slice(b"OpusHead");
    head.push(1); // version
    head.push(1); // channels
    head.extend_from_slice(&pre_skip.to_le_bytes());
    head.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    head.extend_from_slice(&0i16.to_le_bytes()); // output gain
    head.push(0); // one mono stream
    head
}

/// The comment header (RFC 7845, section 5.2): a vendor name and no tags.
fn opus_tags() -> Vec<u8> {
    let vendor = b"Sonolect";
    let mut tags = Vec::with_capacity(24);
    tags.extend_from_slice(b"OpusTags");
    tags.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
    tags.extend_from_slice(vendor);
    tags.extend_from_slice(&0u32.to_le_bytes());
    tags
}

/// Writes 16 kHz mono samples as an Ogg Opus stream.
pub fn encode(
    samples: impl Iterator<Item = Result<i16, String>>,
    output: impl Write,
) -> Result<(), String> {
    let mut encoder =
        opus::Encoder::new(SAMPLE_RATE, opus::Channels::Mono, opus::Application::Voip)
            .map_err(opus_error)?;
    encoder
        .set_bitrate(opus::Bitrate::Bits(BITRATE))
        .map_err(opus_error)?;
    // What the decoder must drop at the start, in 48 kHz samples.
    let lookahead = encoder.get_lookahead().map_err(opus_error)?.max(0) as u64;
    let pre_skip = lookahead * GRANULE_PER_SAMPLE;

    let mut writer = ogg::PacketWriter::new(output);
    writer
        .write_packet(
            opus_head(pre_skip as u16),
            SERIAL,
            ogg::PacketWriteEndInfo::EndPage,
            0,
        )
        .map_err(io_error)?;
    writer
        .write_packet(opus_tags(), SERIAL, ogg::PacketWriteEndInfo::EndPage, 0)
        .map_err(io_error)?;

    let mut frame = [0i16; FRAME];
    let mut filled = 0;
    let mut total: u64 = 0;
    let mut frames = 0usize;
    // One packet is held back so the last one can close the stream.
    let mut waiting: Option<(Vec<u8>, u64)> = None;
    let mut packet = [0u8; MAX_PACKET];
    let mut flush = |frame: &[i16; FRAME],
                     end_granule: u64,
                     waiting: &mut Option<(Vec<u8>, u64)>,
                     frames: &mut usize|
     -> Result<(), String> {
        let length = encoder.encode(frame, &mut packet).map_err(opus_error)?;
        if let Some((data, granule)) = waiting.take() {
            *frames += 1;
            let end = if (*frames).is_multiple_of(FRAMES_PER_PAGE) {
                ogg::PacketWriteEndInfo::EndPage
            } else {
                ogg::PacketWriteEndInfo::NormalPacket
            };
            writer
                .write_packet(data, SERIAL, end, granule)
                .map_err(io_error)?;
        }
        *waiting = Some((packet[..length].to_vec(), end_granule));
        Ok(())
    };
    for sample in samples {
        frame[filled] = sample?;
        filled += 1;
        total += 1;
        if filled == FRAME {
            flush(
                &frame,
                pre_skip + total * GRANULE_PER_SAMPLE,
                &mut waiting,
                &mut frames,
            )?;
            filled = 0;
        }
    }
    if filled > 0 || waiting.is_none() {
        // The last frame is padded with silence; the final granule position
        // tells the decoder where the real audio ends.
        frame[filled..].fill(0);
        flush(
            &frame,
            pre_skip + total * GRANULE_PER_SAMPLE,
            &mut waiting,
            &mut frames,
        )?;
    }
    // The encoder's look-ahead still holds the end of the audio: one more
    // frame of silence pushes it out. The granule position stays at the end
    // of the real audio, so the padding is trimmed on decode.
    frame.fill(0);
    flush(
        &frame,
        pre_skip + total * GRANULE_PER_SAMPLE,
        &mut waiting,
        &mut frames,
    )?;
    if let Some((data, granule)) = waiting.take() {
        writer
            .write_packet(data, SERIAL, ogg::PacketWriteEndInfo::EndStream, granule)
            .map_err(io_error)?;
    }
    writer.into_inner().flush().map_err(io_error)
}

/// The samples of an Ogg Opus stream written by `encode`, decoded one packet
/// at a time so a recording of any length never sits in memory whole.
pub struct Samples<R: Read + Seek> {
    reader: ogg::PacketReader<R>,
    decoder: opus::Decoder,
    /// 48 kHz samples the decoder produces before the real audio starts.
    pre_skip: u64,
    /// Decoded samples still to drop at the start.
    to_skip: usize,
    /// Samples handed out so far.
    emitted: u64,
    block: Vec<i16>,
    position: usize,
    failed: bool,
}

const INVALID: &str = "Invalid compressed audio.";

impl<R: Read + Seek> Samples<R> {
    pub fn open(input: R) -> Result<Self, String> {
        let mut reader = ogg::PacketReader::new(input);
        let head = reader.read_packet().map_err(|_| INVALID)?.ok_or(INVALID)?;
        if head.data.len() < 19 || &head.data[..8] != b"OpusHead" || head.data[9] != 1 {
            return Err(INVALID.into());
        }
        let pre_skip = u64::from(u16::from_le_bytes([head.data[10], head.data[11]]));
        let tags = reader.read_packet().map_err(|_| INVALID)?.ok_or(INVALID)?;
        if tags.data.len() < 8 || &tags.data[..8] != b"OpusTags" {
            return Err(INVALID.into());
        }
        Ok(Self {
            reader,
            decoder: opus::Decoder::new(SAMPLE_RATE, opus::Channels::Mono).map_err(opus_error)?,
            pre_skip,
            to_skip: (pre_skip / GRANULE_PER_SAMPLE) as usize,
            emitted: 0,
            block: Vec::new(),
            position: 0,
            failed: false,
        })
    }

    /// Decodes the next packet into `block`. `Ok(false)` at the end.
    fn refill(&mut self) -> Result<bool, String> {
        // 120 ms is the longest Opus packet.
        let mut frame = [0i16; FRAME * 6];
        loop {
            let Some(packet) = self.reader.read_packet().map_err(|_| INVALID)? else {
                return Ok(false);
            };
            let decoded = self
                .decoder
                .decode(&packet.data, &mut frame, false)
                .map_err(opus_error)?;
            let skipped = self.to_skip.min(decoded);
            self.to_skip -= skipped;
            // A page's position is where its last packet ends, so no packet
            // of it goes past that; on the last page it is where the real
            // audio ends, which trims the padding of the final frame.
            let limit = packet.absgp_page().saturating_sub(self.pre_skip) / GRANULE_PER_SAMPLE;
            let room = limit.saturating_sub(self.emitted) as usize;
            let take = (decoded - skipped).min(room);
            if take == 0 {
                continue;
            }
            self.block.clear();
            self.block
                .extend_from_slice(&frame[skipped..skipped + take]);
            self.position = 0;
            self.emitted += take as u64;
            return Ok(true);
        }
    }
}

impl<R: Read + Seek> Iterator for Samples<R> {
    type Item = Result<i16, String>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.failed {
            return None;
        }
        if self.position == self.block.len() {
            match self.refill() {
                Ok(true) => {}
                Ok(false) => return None,
                Err(error) => {
                    self.failed = true;
                    return Some(Err(error));
                }
            }
        }
        let sample = self.block[self.position];
        self.position += 1;
        Some(Ok(sample))
    }
}

/// The samples of a compressed recording on disk.
pub fn open(path: &Path) -> Result<Samples<BufReader<fs::File>>, String> {
    Samples::open(BufReader::new(
        fs::File::open(path).map_err(|_| GONE.to_string())?,
    ))
}

const GONE: &str = "The audio of this recording is no longer on this device.";

/// Where a recording's audio is, whichever format it is kept in. The WAV
/// wins while both exist: it is only removed once the Opus file is complete.
pub fn audio_file(directory: &Path, id: &str) -> Option<PathBuf> {
    ["wav", "opus"]
        .into_iter()
        .map(|extension| directory.join(format!("{id}.{extension}")))
        .find(|path| path.is_file())
}

pub fn is_compressed(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()) == Some("opus")
}

/// A recording's audio as WAV bytes, for playback.
pub fn read_as_wav(directory: &Path, id: &str) -> Result<Vec<u8>, String> {
    let path = audio_file(directory, id).ok_or(GONE)?;
    if !is_compressed(&path) {
        return match fs::read(&path) {
            Ok(bytes) => Ok(bytes),
            // Compressed between finding the WAV and reading it.
            Err(_) if directory.join(format!("{id}.opus")).is_file() => {
                decoded_wav(&directory.join(format!("{id}.opus")))
            }
            Err(_) => Err(GONE.into()),
        };
    }
    decoded_wav(&path)
}

/// Decoded straight into the WAV, so the audio is in memory only once.
fn decoded_wav(path: &Path) -> Result<Vec<u8>, String> {
    let mut bytes = vec![0u8; 44];
    for sample in open(path)? {
        bytes.extend_from_slice(&sample?.to_le_bytes());
    }
    let samples = (bytes.len() as u64 - 44) / 2;
    bytes[..44].copy_from_slice(&super::streaming::wav_header(samples));
    Ok(bytes)
}

/// Compresses the WAV of a finished recording and removes it. Returns how
/// many bytes that freed; `Ok(0)` when the recording is already compressed
/// or has no audio. A WAV that is not 16 kHz mono is left as it is.
pub fn compress(directory: &Path, id: &str) -> Result<u64, String> {
    let wav = directory.join(format!("{id}.wav"));
    if !wav.is_file() {
        return Ok(0);
    }
    let reader = hound::WavReader::open(&wav).map_err(|e| format!("Invalid WAV audio: {e}"))?;
    let spec = reader.spec();
    if spec.channels != 1
        || spec.sample_rate != SAMPLE_RATE
        || spec.bits_per_sample != 16
        || spec.sample_format != hound::SampleFormat::Int
    {
        return Ok(0);
    }
    let before = fs::metadata(&wav).map(|m| m.len()).unwrap_or(0);
    let temp = directory.join(format!("{id}.opus.tmp"));
    let opus = directory.join(format!("{id}.opus"));
    let written = fs::File::create(&temp)
        .map_err(io_error)
        .and_then(|file| {
            encode(
                reader
                    .into_samples::<i16>()
                    .map(|sample| sample.map_err(|e| format!("Invalid WAV audio: {e}"))),
                BufWriter::new(file),
            )
        })
        // Rename replaces atomically on supported desktop filesystems.
        .and_then(|()| fs::rename(&temp, &opus).map_err(io_error));
    if let Err(error) = written {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    let after = fs::metadata(&opus).map(|m| m.len()).unwrap_or(0);
    fs::remove_file(&wav).map_err(io_error)?;
    Ok(before.saturating_sub(after))
}

/// What compressing the saved recordings did.
#[derive(Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compressed {
    /// Recordings that were compressed just now.
    pub recordings: u32,
    pub bytes_freed: u64,
    /// Recordings that could not be compressed; their WAV is untouched.
    pub failed: u32,
}

/// Recordings whose WAV is still being written or read piece by piece.
static HELD: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// One pass over the recordings at a time: two would write the same file.
static COMPRESSING: Mutex<()> = Mutex::new(());

/// Keeps a recording's WAV in place until dropped.
pub struct Hold(String);

/// Marks a recording as in use, so `compress_all` leaves it alone. Taken
/// before the recording's file exists and kept until its audio is complete.
pub fn hold(id: &str) -> Hold {
    HELD.lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .push(id.to_owned());
    Hold(id.to_owned())
}

impl Drop for Hold {
    fn drop(&mut self) {
        let mut held = HELD.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(index) = held.iter().position(|id| *id == self.0) {
            held.swap_remove(index);
        }
    }
}

fn held(id: &str) -> bool {
    HELD.lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .any(|held| held == id)
}

/// Compresses every finished recording that is still a WAV.
pub fn compress_all(directory: &Path) -> Result<Compressed, String> {
    let _one_at_a_time = COMPRESSING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut done = Compressed::default();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wav") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        // Only the app's own recordings: system-audio files keep their format.
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit() || c == '-') || held(id) {
            continue;
        }
        match compress(directory, id) {
            Ok(0) => {}
            Ok(freed) => {
                done.recordings += 1;
                done.bytes_freed += freed;
            }
            Err(_) => done.failed += 1,
        }
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A voice-like signal: a few harmonics with a slow swell.
    fn speech(seconds: f32) -> Vec<i16> {
        (0..(seconds * SAMPLE_RATE as f32) as usize)
            .map(|i| {
                let t = i as f32 / SAMPLE_RATE as f32;
                let swell = 0.6 + 0.4 * (t * 3.0).sin();
                let tone = (t * 180.0 * std::f32::consts::TAU).sin()
                    + 0.5 * (t * 360.0 * std::f32::consts::TAU).sin()
                    + 0.25 * (t * 720.0 * std::f32::consts::TAU).sin();
                (tone * swell * 5000.0) as i16
            })
            .collect()
    }

    fn decode(bytes: Vec<u8>) -> Result<Vec<i16>, String> {
        Samples::open(std::io::Cursor::new(bytes))?.collect()
    }

    fn encoded(samples: &[i16]) -> Vec<u8> {
        let mut bytes = Vec::new();
        encode(samples.iter().map(|s| Ok(*s)), &mut bytes).unwrap();
        bytes
    }

    fn energy(samples: &[i16]) -> f64 {
        samples.iter().map(|s| f64::from(*s).powi(2)).sum::<f64>() / samples.len().max(1) as f64
    }

    #[test]
    fn keeps_the_exact_length_of_the_recording() {
        // Whole frames, a partial last frame, a single sample, and nothing.
        for length in [16_000usize, 16_000 + 37, 320, 319, 1, 0] {
            let samples = speech(2.0)[..length].to_vec();
            let decoded = decode(encoded(&samples)).unwrap();
            assert_eq!(decoded.len(), length, "length {length}");
        }
    }

    #[test]
    fn sounds_like_the_original_and_is_far_smaller() {
        // A rising tone never repeats, so there is only one way to line it up.
        let samples: Vec<i16> = (0..160_000)
            .map(|i| {
                let t = i as f32 / SAMPLE_RATE as f32;
                let phase = std::f32::consts::TAU * (150.0 * t + 60.0 * t * t);
                (phase.sin() * 6000.0) as i16
            })
            .collect();
        let bytes = encoded(&samples);
        // 10 s of WAV is 320 000 bytes; 24 kbit/s is about a tenth of that.
        assert!(bytes.len() < 320_000 / 6, "{} bytes", bytes.len());
        let decoded = decode(bytes).unwrap();
        // Lossy, so compare loudness and alignment rather than samples.
        let ratio = energy(&decoded) / energy(&samples);
        assert!((0.7..1.3).contains(&ratio), "energy ratio {ratio}");
        // The decoded audio lines up with the original: sliding it either
        // way only makes the match worse.
        let match_at = |shift: i64| -> f64 {
            (1000..samples.len() as i64 - 1000)
                .map(|i| f64::from(samples[i as usize]) * f64::from(decoded[(i + shift) as usize]))
                .sum()
        };
        let best = (-160..=160i64)
            .max_by(|a, b| match_at(*a).total_cmp(&match_at(*b)))
            .unwrap();
        assert!(
            best.abs() <= 2,
            "decoded audio is shifted by {best} samples"
        );
    }

    #[test]
    fn writes_a_standard_ogg_opus_stream() {
        let bytes = encoded(&speech(1.0));
        assert_eq!(&bytes[..4], b"OggS");
        let mut reader = ogg::PacketReader::new(std::io::Cursor::new(bytes));
        let head = reader.read_packet_expected().unwrap();
        assert_eq!(&head.data[..8], b"OpusHead");
        assert_eq!(head.data[8], 1);
        assert_eq!(head.data[9], 1);
        assert_eq!(
            u32::from_le_bytes(head.data[12..16].try_into().unwrap()),
            16_000
        );
        let tags = reader.read_packet_expected().unwrap();
        assert_eq!(&tags.data[..8], b"OpusTags");
        let mut last = None;
        while let Some(packet) = reader.read_packet().unwrap() {
            last = Some(packet);
        }
        let last = last.unwrap();
        assert!(last.last_in_stream());
        let pre_skip = u64::from(u16::from_le_bytes([head.data[10], head.data[11]]));
        assert_eq!(last.absgp_page(), pre_skip + 48_000);
    }

    #[test]
    fn rejects_files_that_are_not_ogg_opus() {
        assert!(decode(b"RIFF....WAVE".to_vec()).is_err());
        assert!(decode(Vec::new()).is_err());
    }

    #[test]
    fn compresses_a_saved_recording_and_reads_it_back_as_wav() {
        let folder = tempfile::tempdir().unwrap();
        let samples = speech(5.0);
        let wav = folder.path().join("7-1.wav");
        fs::write(&wav, crate::streaming::wav_bytes(&samples)).unwrap();
        assert_eq!(audio_file(folder.path(), "7-1"), Some(wav.clone()));

        let freed = compress(folder.path(), "7-1").unwrap();
        assert!(freed > 100_000, "freed {freed}");
        assert!(!wav.exists());
        assert!(!folder.path().join("7-1.opus.tmp").exists());
        let opus = folder.path().join("7-1.opus");
        assert_eq!(audio_file(folder.path(), "7-1"), Some(opus.clone()));
        // Compressing again changes nothing.
        assert_eq!(compress(folder.path(), "7-1").unwrap(), 0);

        let bytes = read_as_wav(folder.path(), "7-1").unwrap();
        let reader = hound::WavReader::new(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(reader.spec().sample_rate, 16_000);
        assert_eq!(reader.duration() as usize, samples.len());

        // Read piece by piece, it is the same length.
        assert_eq!(open(&opus).unwrap().count(), samples.len());
    }

    #[test]
    fn leaves_other_audio_alone() {
        let folder = tempfile::tempdir().unwrap();
        // 44.1 kHz stereo: not something the recorder writes.
        let path = folder.path().join("8-1.wav");
        let mut writer = hound::WavWriter::create(
            &path,
            hound::WavSpec {
                channels: 2,
                sample_rate: 44_100,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .unwrap();
        for _ in 0..1000 {
            writer.write_sample(0i16).unwrap();
        }
        writer.finalize().unwrap();
        assert_eq!(compress(folder.path(), "8-1").unwrap(), 0);
        assert!(path.exists());
        assert!(!folder.path().join("8-1.opus").exists());
        // No recording at all.
        assert_eq!(compress(folder.path(), "9-1").unwrap(), 0);
        assert!(read_as_wav(folder.path(), "9-1").is_err());
    }

    #[test]
    fn compresses_every_finished_recording_but_not_the_one_in_progress() {
        let folder = tempfile::tempdir().unwrap();
        let wav = crate::streaming::wav_bytes(&speech(2.0));
        // IDs of their own: what is held is shared by every test.
        for name in ["771-1.wav", "772-1.wav", "773-1.wav", "system-55.wav"] {
            fs::write(folder.path().join(name), &wav).unwrap();
        }
        // Not audio at all: counted as failed and left in place.
        fs::write(folder.path().join("774-1.wav"), b"RIFF").unwrap();
        let recording = hold("773-1");
        let done = compress_all(folder.path()).unwrap();
        assert_eq!(done.recordings, 2);
        assert_eq!(done.failed, 1);
        assert!(done.bytes_freed > 80_000, "{}", done.bytes_freed);
        assert!(folder.path().join("771-1.opus").exists());
        assert!(folder.path().join("772-1.opus").exists());
        assert!(folder.path().join("773-1.wav").exists());
        assert!(folder.path().join("774-1.wav").exists());
        assert!(folder.path().join("system-55.wav").exists());
        // Nothing left to do the second time, apart from the broken file.
        let again = compress_all(folder.path()).unwrap();
        assert_eq!((again.recordings, again.bytes_freed), (0, 0));
        // Once the recording is finished it is compressed like the others.
        drop(recording);
        assert_eq!(compress_all(folder.path()).unwrap().recordings, 1);
        assert!(folder.path().join("773-1.opus").exists());
    }
}
