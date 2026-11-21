//! Saved recordings as Ogg Opus: about a tenth of the size of WAV.
//!
//! A recording is always made as WAV, which survives a crash mid-recording.
//! Once it is finished it can be compressed to `{id}.opus`. Everything that
//! transcribes a recording decodes it back to the same 16 kHz mono samples,
//! and playback can take the Opus file as it is.
use std::{
    fs::{self, File},
    io::{BufReader, Cursor, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

/// What the speech engine works with, and so what recordings are stored at.
pub const SAMPLE_RATE: u32 = 16_000;
/// 20 ms of audio at 16 kHz: the frame size Opus is tuned for.
const FRAME: usize = 320;
/// Wideband speech is transparent to a speech engine well below this.
const BITRATE: i32 = 24_000;
/// Opus counts time at 48 kHz whatever the input rate.
const GRANULE_RATE: u32 = 48_000;
const GRANULE_PER_SAMPLE: u64 = (GRANULE_RATE / SAMPLE_RATE) as u64;
/// One Ogg page a second keeps seeking and recovery cheap.
const FRAMES_PER_PAGE: usize = 50;
const SERIAL: u32 = 0x534f_4e4f;
/// Room for one encoded 20 ms frame at any bitrate (at most 1275 bytes).
const MAX_PACKET: usize = 1500;
/// The header of a WAV file as this app writes it.
const WAV_HEADER: usize = 44;

fn opus_error(error: opus::Error) -> String {
    format!("Opus error: {error}")
}

fn io_error(error: std::io::Error) -> String {
    format!("Cannot write compressed audio: {error}")
}

/// The identification header of an Ogg Opus stream (RFC 7845, section 5.1).
fn opus_head(channels: u8, pre_skip: u16, input_rate: u32) -> Vec<u8> {
    let mut head = Vec::with_capacity(19);
    head.extend_from_slice(b"OpusHead");
    head.push(1); // version
    head.push(channels);
    head.extend_from_slice(&pre_skip.to_le_bytes());
    head.extend_from_slice(&input_rate.to_le_bytes());
    head.extend_from_slice(&0i16.to_le_bytes()); // output gain
    head.push(0); // mapping family 0: one mono or stereo stream
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

/// Writes interleaved 16-bit audio as an Ogg Opus stream while it arrives.
///
/// The audio is encoded in 20 ms frames and an Ogg page goes out about every
/// second. Written to a file without a buffer (see `create`), a recording
/// cut off by a crash keeps everything up to its last whole page. One packet
/// is always held back, so the last one can close the stream.
pub struct OpusWriter<W: Write> {
    encoder: opus::Encoder,
    output: ogg::PacketWriter<'static, W>,
    channels: usize,
    /// The frame being filled: 20 ms of every channel, interleaved.
    frame: Vec<i16>,
    /// Samples in `frame` so far.
    filled: usize,
    /// Granule units (48 kHz) per sample of one channel.
    granule_per_sample: u64,
    /// What the decoder drops at the start, in 48 kHz samples.
    pre_skip: u64,
    /// Samples of each channel taken so far.
    taken: u64,
    /// Frames encoded so far.
    encoded: u64,
    /// Packets handed to the Ogg stream so far.
    packets: usize,
    /// The last packet encoded and its granule position, not written yet.
    waiting: Option<(Vec<u8>, u64)>,
    packet: [u8; MAX_PACKET],
    /// Makes the finished stream durable once it is flushed: a file is
    /// synced to its disk.
    persist: fn(&mut W) -> std::io::Result<()>,
}

impl OpusWriter<File> {
    /// Starts an Ogg Opus file at `path`, replacing any file there. It is
    /// written without a buffer, so every page reaches the file as soon as
    /// it is complete, and `finish` syncs it to its disk.
    pub fn create(
        path: &Path,
        rate: u32,
        channels: u8,
        bitrate: i32,
        application: opus::Application,
    ) -> Result<Self, String> {
        let file = File::create(path).map_err(io_error)?;
        let mut writer = Self::new(file, rate, channels, bitrate, application)?;
        writer.persist = |file| file.sync_all();
        Ok(writer)
    }
}

impl<W: Write> OpusWriter<W> {
    /// Starts an Ogg Opus stream of one or two channels at `rate`, one of the
    /// rates Opus takes (8, 12, 16, 24 or 48 kHz), and writes its headers.
    pub fn new(
        output: W,
        rate: u32,
        channels: u8,
        bitrate: i32,
        application: opus::Application,
    ) -> Result<Self, String> {
        let layout = match channels {
            1 => opus::Channels::Mono,
            2 => opus::Channels::Stereo,
            _ => return Err(format!("Opus error: {channels} channels")),
        };
        let mut encoder = opus::Encoder::new(rate, layout, application).map_err(opus_error)?;
        encoder
            .set_bitrate(opus::Bitrate::Bits(bitrate))
            .map_err(opus_error)?;
        // Every rate Opus takes divides 48 kHz.
        let granule_per_sample = u64::from(GRANULE_RATE / rate);
        let lookahead = encoder.get_lookahead().map_err(opus_error)?.max(0) as u64;
        let pre_skip = lookahead * granule_per_sample;

        let mut output = ogg::PacketWriter::new(output);
        output
            .write_packet(
                opus_head(channels, pre_skip as u16, rate),
                SERIAL,
                ogg::PacketWriteEndInfo::EndPage,
                0,
            )
            .map_err(io_error)?;
        output
            .write_packet(opus_tags(), SERIAL, ogg::PacketWriteEndInfo::EndPage, 0)
            .map_err(io_error)?;
        let channels = usize::from(channels);
        Ok(Self {
            encoder,
            output,
            channels,
            frame: vec![0; rate as usize / 50 * channels],
            filled: 0,
            granule_per_sample,
            pre_skip,
            taken: 0,
            encoded: 0,
            packets: 0,
            waiting: None,
            packet: [0; MAX_PACKET],
            persist: |_| Ok(()),
        })
    }

    /// Adds interleaved samples. A frame, even a frame of one sample per
    /// channel, can be split between calls.
    pub fn write(&mut self, interleaved: &[i16]) -> Result<(), String> {
        let mut rest = interleaved;
        while !rest.is_empty() {
            let take = (self.frame.len() - self.filled).min(rest.len());
            self.frame[self.filled..self.filled + take].copy_from_slice(&rest[..take]);
            self.filled += take;
            rest = &rest[take..];
            if self.filled == self.frame.len() {
                self.taken += (self.frame.len() / self.channels) as u64;
                self.filled = 0;
                self.encode_frame()?;
            }
        }
        Ok(())
    }

    /// Where the audio a decoder has after the frames encoded so far ends,
    /// in 48 kHz samples: 20 ms a frame, the pre-skip included.
    fn decodable(&self) -> u64 {
        self.encoded * (self.frame.len() / self.channels) as u64 * self.granule_per_sample
    }

    /// Where the audio taken so far ends in the decoder's output, in 48 kHz
    /// samples: the pre-skip comes first.
    fn audio_end(&self) -> u64 {
        self.pre_skip + self.taken * self.granule_per_sample
    }

    /// Encodes the frame and writes the packet held back before it.
    ///
    /// A packet's granule position is where the audio a decoder has after it
    /// ends (RFC 7845, section 4), so every page ends exactly where its
    /// audio does. Only the last packet ends earlier, where the real audio
    /// does, which trims the padding of the last frame.
    fn encode_frame(&mut self) -> Result<(), String> {
        let length = self
            .encoder
            .encode(&self.frame, &mut self.packet)
            .map_err(opus_error)?;
        if let Some((data, granule)) = self.waiting.take() {
            self.packets += 1;
            let end = if self.packets.is_multiple_of(FRAMES_PER_PAGE) {
                ogg::PacketWriteEndInfo::EndPage
            } else {
                ogg::PacketWriteEndInfo::NormalPacket
            };
            self.output
                .write_packet(data, SERIAL, end, granule)
                .map_err(io_error)?;
        }
        self.encoded += 1;
        self.waiting = Some((
            self.packet[..length].to_vec(),
            self.decodable().min(self.audio_end()),
        ));
        Ok(())
    }

    /// Ends the stream and returns the output once what was written is
    /// durable.
    pub fn finish(mut self) -> Result<W, String> {
        self.taken += (self.filled / self.channels) as u64;
        if self.filled > 0 || self.waiting.is_none() {
            // The last frame is padded with silence.
            self.frame[self.filled..].fill(0);
            self.encode_frame()?;
        }
        // A decoder gives out each frame late, by the encoder's look-ahead
        // (the pre-skip). Unless the padding already covers it, one more
        // frame of silence pushes out the end of the audio. The stream ends
        // with the first packet that reaches the end of the real audio, and
        // its granule position trims the rest on decode.
        while self.decodable() < self.audio_end() {
            self.frame.fill(0);
            self.encode_frame()?;
        }
        if let Some((data, granule)) = self.waiting.take() {
            self.output
                .write_packet(data, SERIAL, ogg::PacketWriteEndInfo::EndStream, granule)
                .map_err(io_error)?;
        }
        let mut output = self.output.into_inner();
        output.flush().map_err(io_error)?;
        (self.persist)(&mut output).map_err(io_error)?;
        Ok(output)
    }
}

/// Encodes 16 kHz mono samples with `writer` and ends its stream.
fn write_samples<W: Write>(
    samples: impl Iterator<Item = Result<i16, String>>,
    mut writer: OpusWriter<W>,
) -> Result<W, String> {
    const BLOCK: usize = FRAME * FRAMES_PER_PAGE;
    let mut block = Vec::with_capacity(BLOCK);
    for sample in samples {
        block.push(sample?);
        if block.len() == BLOCK {
            writer.write(&block)?;
            block.clear();
        }
    }
    writer.write(&block)?;
    writer.finish()
}

/// Writes 16 kHz mono samples as an Ogg Opus stream with the settings
/// compressed recordings are kept at: 24 kbit/s, tuned for speech. `compress`
/// writes the same stream straight to its file; this is the in-memory form
/// the tests check it with.
#[cfg(test)]
fn encode(
    samples: impl Iterator<Item = Result<i16, String>>,
    output: impl Write,
) -> Result<(), String> {
    let writer = OpusWriter::new(output, SAMPLE_RATE, 1, BITRATE, opus::Application::Voip)?;
    write_samples(samples, writer).map(drop)
}

/// The samples of an Ogg Opus stream, mono or stereo at any rate, decoded to
/// 16 kHz mono one packet at a time, so a recording of any length never sits
/// in memory whole.
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
    done: bool,
}

const INVALID: &str = "Invalid compressed audio.";

impl<R: Read + Seek> Samples<R> {
    pub fn open(input: R) -> Result<Self, String> {
        let mut reader = ogg::PacketReader::new(input);
        let head = reader.read_packet().map_err(|_| INVALID)?.ok_or(INVALID)?;
        // One mono or stereo stream (mapping family 0). The decoder is made
        // for 16 kHz mono whatever the stream holds, so a stereo or 48 kHz
        // recording comes out as the speech engine needs it.
        if head.data.len() < 19
            || &head.data[..8] != b"OpusHead"
            || !(1..=2).contains(&head.data[9])
            || head.data[18] != 0
        {
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
            done: false,
        })
    }

    /// Decodes the next packet into `block`. `Ok(false)` at the end.
    fn refill(&mut self) -> Result<bool, String> {
        // 120 ms is the longest Opus packet.
        let mut frame = [0i16; FRAME * 6];
        loop {
            let packet = match self.reader.read_packet() {
                Ok(Some(packet)) => packet,
                Ok(None) => return Ok(false),
                // Written page by page and cut off by a crash, the file ends
                // inside its last page: what came before is the recording.
                // A file that ends before any audio is not one.
                Err(ogg::OggReadError::ReadError(error))
                    if error.kind() == std::io::ErrorKind::UnexpectedEof && self.emitted > 0 =>
                {
                    return Ok(false)
                }
                Err(_) => return Err(INVALID.into()),
            };
            let decoded = self
                .decoder
                .decode(&packet.data, &mut frame, false)
                .map_err(opus_error)?;
            let skipped = self.to_skip.min(decoded);
            self.to_skip -= skipped;
            // A page's position is where its last packet ends, so no packet
            // of it goes past that; on the last page it is where the real
            // audio ends, which trims the padding of the final frame. Files
            // from earlier versions put every page but the last one pre-skip
            // later than that, which only moves the limit later: they decode
            // the same.
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
        if self.done {
            return None;
        }
        if self.position == self.block.len() {
            match self.refill() {
                Ok(true) => {}
                Ok(false) => {
                    self.done = true;
                    return None;
                }
                Err(error) => {
                    self.done = true;
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
pub fn open(path: &Path) -> Result<Samples<BufReader<File>>, String> {
    Samples::open(BufReader::new(
        File::open(path).map_err(|_| GONE.to_string())?,
    ))
}

pub const GONE: &str = "The audio of this recording is no longer on this device.";

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

/// Brings the sizes in the header of a recording's WAV up to date with a
/// file of `length` bytes. Returns whether they changed.
///
/// While a recording is made its header is brought up to date every few
/// seconds, so after a hard stop the last seconds are in the file but not
/// counted, and every reader would leave them out. Only the header this app
/// writes is touched (16 kHz mono 16-bit PCM, the data right after it and
/// nothing after the data), only when it counts less than the file holds,
/// and only up to whole samples, so no audio is ever cut.
fn update_wav_sizes(header: &mut [u8], length: u64) -> bool {
    let ours = super::streaming::wav_header(0);
    if header.len() < WAV_HEADER || header[..4] != ours[..4] || header[8..40] != ours[8..40] {
        return false;
    }
    let size_at = |at: usize| {
        u64::from(u32::from_le_bytes([
            header[at],
            header[at + 1],
            header[at + 2],
            header[at + 3],
        ]))
    };
    let (riff, data) = (size_at(4), size_at(40));
    if riff != 36 + data {
        return false;
    }
    // What the file holds, in whole samples, as much as a header can count.
    let block = u64::from(u16::from_le_bytes([ours[32], ours[33]]));
    let held = length
        .saturating_sub(WAV_HEADER as u64)
        .min(u64::from(u32::MAX) - 36);
    let held = held - held % block;
    if held <= data {
        return false;
    }
    header[4..8].copy_from_slice(&((36 + held) as u32).to_le_bytes());
    header[40..44].copy_from_slice(&(held as u32).to_le_bytes());
    true
}

/// Brings the header of a recording's WAV up to date with the audio in its
/// file (see `update_wav_sizes`), keeping the file's times. Returns whether
/// the header changed.
pub fn repair_wav_header(path: &Path) -> Result<bool, String> {
    let error = |error: std::io::Error| format!("Cannot update recording: {error}");
    let mut file = File::options()
        .read(true)
        .write(true)
        .open(path)
        .map_err(error)?;
    let metadata = file.metadata().map_err(error)?;
    let mut header = [0u8; WAV_HEADER];
    if metadata.len() < WAV_HEADER as u64 {
        return Ok(false);
    }
    file.read_exact(&mut header).map_err(error)?;
    if !update_wav_sizes(&mut header, metadata.len()) {
        return Ok(false);
    }
    file.seek(SeekFrom::Start(0)).map_err(error)?;
    file.write_all(&header).map_err(error)?;
    // Writing the header is not a change to the recording: the times stay
    // as they were.
    let mut times = fs::FileTimes::new();
    if let Ok(accessed) = metadata.accessed() {
        times = times.set_accessed(accessed);
    }
    if let Ok(modified) = metadata.modified() {
        times = times.set_modified(modified);
    }
    file.set_times(times).map_err(error)?;
    Ok(true)
}

/// A recording's WAV, open for hound with every sample in its file counted.
/// The header on disk is brought up to date where it can be; where it cannot
/// (a read-only file, say), only the header read is.
pub fn open_wav(path: &Path) -> Result<hound::WavReader<impl Read>, String> {
    let _ = repair_wav_header(path);
    read_wav(path)
}

/// A WAV file for hound, with every sample in it counted (see
/// `update_wav_sizes`) and the file left as it is.
fn read_wav(path: &Path) -> Result<hound::WavReader<impl Read>, String> {
    let invalid = |error: &dyn std::fmt::Display| format!("Invalid WAV audio: {error}");
    let file = File::open(path).map_err(|e| invalid(&e))?;
    let length = file.metadata().map_err(|e| invalid(&e))?.len();
    let mut file = BufReader::new(file);
    let mut header = Vec::with_capacity(WAV_HEADER);
    file.by_ref()
        .take(WAV_HEADER as u64)
        .read_to_end(&mut header)
        .map_err(|e| invalid(&e))?;
    update_wav_sizes(&mut header, length);
    hound::WavReader::new(Cursor::new(header).chain(file)).map_err(|e| invalid(&e))
}

/// A WAV file's bytes, with every sample in it counted and the file left as
/// it is.
fn read_whole_wav(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut bytes = fs::read(path)?;
    let length = bytes.len() as u64;
    update_wav_sizes(&mut bytes, length);
    Ok(bytes)
}

/// A recording's audio for playback. With `prefer_ogg`, a compressed
/// recording is its Ogg Opus file as it is, for a webview that plays Ogg
/// Opus; otherwise it is decoded to 16 kHz WAV. A WAV recording is always
/// WAV, with every sample in its file counted.
pub fn read_for_playback(directory: &Path, id: &str, prefer_ogg: bool) -> Result<Vec<u8>, String> {
    let path = audio_file(directory, id).ok_or(GONE)?;
    if is_compressed(&path) {
        return compressed_for_playback(&path, prefer_ogg);
    }
    // A header that cannot be written is no reason not to play: the copy
    // read counts every sample either way.
    let _ = repair_wav_header(&path);
    match read_whole_wav(&path) {
        Ok(bytes) => Ok(bytes),
        // Compressed between finding the WAV and reading it.
        Err(_) if directory.join(format!("{id}.opus")).is_file() => {
            compressed_for_playback(&directory.join(format!("{id}.opus")), prefer_ogg)
        }
        Err(_) => Err(GONE.into()),
    }
}

fn compressed_for_playback(path: &Path, prefer_ogg: bool) -> Result<Vec<u8>, String> {
    if prefer_ogg {
        fs::read(path).map_err(|_| GONE.into())
    } else {
        decoded_wav(path)
    }
}

/// Decoded straight into the WAV, so the audio is in memory only once.
fn decoded_wav(path: &Path) -> Result<Vec<u8>, String> {
    let mut bytes = vec![0u8; WAV_HEADER];
    for sample in open(path)? {
        bytes.extend_from_slice(&sample?.to_le_bytes());
    }
    let samples = (bytes.len() - WAV_HEADER) as u64 / 2;
    bytes[..WAV_HEADER].copy_from_slice(&super::streaming::wav_header(samples));
    Ok(bytes)
}

/// Compresses the WAV of a finished recording and removes it. Returns how
/// many bytes that freed; `Ok(0)` when the recording is already compressed
/// or has no audio. A WAV that is not 16 kHz mono is left as it is.
///
/// A recording that already has its Opus file is never encoded again: that
/// file can hold more than the WAV (a high-quality copy, say), and the WAV
/// is only what an interruption left behind. The WAV is removed once the
/// Opus file is known to hold all of its audio, and kept otherwise.
pub fn compress(directory: &Path, id: &str) -> Result<u64, String> {
    let wav = directory.join(format!("{id}.wav"));
    if !wav.is_file() {
        return Ok(0);
    }
    // The WAV goes once it is compressed, so whatever a crash left uncounted
    // in its header is counted here.
    let reader = open_wav(&wav)?;
    let spec = reader.spec();
    if spec.channels != 1
        || spec.sample_rate != SAMPLE_RATE
        || spec.bits_per_sample != 16
        || spec.sample_format != hound::SampleFormat::Int
    {
        return Ok(0);
    }
    let before = fs::metadata(&wav).map(|m| m.len()).unwrap_or(0);
    let opus = directory.join(format!("{id}.opus"));
    if opus.is_file() {
        let in_wav = u64::from(reader.duration());
        drop(reader);
        let mut in_opus = 0u64;
        for sample in open(&opus)? {
            sample?;
            in_opus += 1;
        }
        // One frame of rounding between two files of the same audio.
        if in_opus + (FRAME as u64) < in_wav {
            return Err("The compressed audio is shorter than the recording.".into());
        }
        fs::remove_file(&wav).map_err(io_error)?;
        return Ok(before);
    }
    let temp = directory.join(format!("{id}.opus.tmp"));
    let written = OpusWriter::create(&temp, SAMPLE_RATE, 1, BITRATE, opus::Application::Voip)
        .and_then(|writer| {
            write_samples(
                reader
                    .into_samples::<i16>()
                    .map(|sample| sample.map_err(|e| format!("Invalid WAV audio: {e}"))),
                writer,
            )
        })
        // Synced to its disk by now; rename replaces atomically on supported
        // desktop filesystems.
        .and_then(|_| fs::rename(&temp, &opus).map_err(io_error));
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

/// Whether a recording's audio is being written or read right now.
pub fn held(id: &str) -> bool {
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
        // Whole frames, a partial last frame (with padding that covers the
        // encoder's look-ahead, and with padding that does not, also on the
        // last frame of a page), a single sample, and nothing.
        for length in [
            16_000usize,
            16_000 + 37,
            15_780,
            15_980,
            320,
            319,
            217,
            216,
            1,
            0,
        ] {
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

        let bytes = read_for_playback(folder.path(), "7-1", false).unwrap();
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
        let original = fs::read(&path).unwrap();
        assert_eq!(compress(folder.path(), "8-1").unwrap(), 0);
        assert!(fs::read(&path).unwrap() == original);
        assert!(!folder.path().join("8-1.opus").exists());
        // No recording at all.
        assert_eq!(compress(folder.path(), "9-1").unwrap(), 0);
        assert!(read_for_playback(folder.path(), "9-1", false).is_err());
        assert!(read_for_playback(folder.path(), "9-1", true).is_err());
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

    /// Checks the granule positions of an Ogg Opus stream of `length`
    /// samples per channel at `rate` (RFC 7845, section 4): the headers are
    /// at 0, every other page ends exactly where the audio decoded up to it
    /// ends, and the stream ends with the first packet that reaches the end
    /// of the real audio, at that end.
    fn assert_granules_follow_the_audio(bytes: Vec<u8>, rate: u32, length: usize, case: &str) {
        let mut reader = ogg::PacketReader::new(std::io::Cursor::new(bytes));
        let head = reader.read_packet_expected().unwrap();
        let tags = reader.read_packet_expected().unwrap();
        assert_eq!((head.absgp_page(), tags.absgp_page()), (0, 0), "{case}");
        let pre_skip = u64::from(u16::from_le_bytes([head.data[10], head.data[11]]));
        let end = pre_skip + length as u64 * u64::from(48_000 / rate);
        // What a decoder has after each packet, in 48 kHz samples.
        let mut decoded = 0u64;
        loop {
            let packet = reader.read_packet_expected().unwrap();
            let before = decoded;
            decoded += opus::packet::get_nb_samples(&packet.data, 48_000).unwrap() as u64;
            if packet.last_in_stream() {
                assert_eq!(packet.absgp_page(), end, "{case}");
                assert!(
                    before < end && end <= decoded,
                    "{case}: the last packet goes from {before} to {decoded}, the audio ends at {end}"
                );
                break;
            }
            if packet.last_in_page() {
                assert_eq!(packet.absgp_page(), decoded, "{case}");
            }
        }
        assert!(reader.read_packet().unwrap().is_none(), "{case}");
    }

    #[test]
    fn every_page_ends_where_its_audio_ends() {
        // Nothing; whole frames and pages; a last frame whose padding covers
        // the encoder's look-ahead, or just does, or does not, also when that
        // frame is the last of a page.
        let audio = speech(5.0);
        for length in [
            0usize, 1, 103, 104, 216, 217, 319, 320, 15_780, 15_980, 16_000, 16_037, 80_000,
        ] {
            let case = format!("16 kHz mono, {length} samples");
            assert_granules_follow_the_audio(encoded(&audio[..length]), 16_000, length, &case);
        }
        for frames in [0usize, 47_040 + 100, 48_000, 96_037] {
            let mut writer =
                OpusWriter::new(Vec::new(), 48_000, 2, 96_000, opus::Application::Audio).unwrap();
            writer.write(&sweeps(48_000, 2, frames)).unwrap();
            let case = format!("48 kHz stereo, {frames} samples");
            assert_granules_follow_the_audio(writer.finish().unwrap(), 48_000, frames, &case);
        }
    }

    /// Two signals that never repeat and have nothing in common, so there
    /// is one way to line each up: a sweep up from 150 Hz on the first
    /// channel and one down from 2 kHz on the second, interleaved.
    fn sweeps(rate: u32, channels: usize, frames: usize) -> Vec<i16> {
        let sweep = |start: f32, change: f32, t: f32| {
            ((start * t + change * t * t) * std::f32::consts::TAU).sin() * 8000.0
        };
        (0..frames)
            .flat_map(|i| {
                let t = i as f32 / rate as f32;
                [sweep(150.0, 60.0, t), sweep(2000.0, -150.0, t)]
                    .into_iter()
                    .take(channels)
                    .map(|sample| sample as i16)
            })
            .collect()
    }

    /// Similarity of two signals from -1 to 1, with `b` shifted by `shift`.
    fn correlation(a: &[f64], b: &[f64], shift: i64) -> f64 {
        let (mut dot, mut ea, mut eb) = (0.0, 0.0, 0.0);
        for i in 1000..a.len().min(b.len()) as i64 - 1000 {
            let (x, y) = (a[i as usize], b[(i + shift) as usize]);
            dot += x * y;
            ea += x * x;
            eb += y * y;
        }
        dot / (ea * eb).sqrt().max(1e-9)
    }

    fn channel(samples: &[i16], channels: usize, which: usize) -> Vec<f64> {
        samples
            .iter()
            .skip(which)
            .step_by(channels)
            .map(|sample| f64::from(*sample))
            .collect()
    }

    /// Decodes a stream at its own rate with every channel kept and the
    /// pre-skip dropped: what a webview plays.
    fn decode_full_band(bytes: Vec<u8>, channels: usize) -> Vec<i16> {
        let mut reader = ogg::PacketReader::new(std::io::Cursor::new(bytes));
        let head = reader.read_packet_expected().unwrap();
        let rate = u32::from_le_bytes(head.data[12..16].try_into().unwrap());
        let pre_skip = usize::from(u16::from_le_bytes([head.data[10], head.data[11]]))
            / (48_000 / rate as usize);
        reader.read_packet_expected().unwrap();
        let layout = if channels == 2 {
            opus::Channels::Stereo
        } else {
            opus::Channels::Mono
        };
        let mut decoder = opus::Decoder::new(rate, layout).unwrap();
        let mut out = Vec::new();
        let mut frame = vec![0i16; 5760 * channels];
        while let Some(packet) = reader.read_packet().unwrap() {
            let decoded = decoder.decode(&packet.data, &mut frame, false).unwrap();
            out.extend_from_slice(&frame[..decoded * channels]);
        }
        out.split_off(pre_skip * channels)
    }

    #[test]
    fn the_writer_takes_mono_or_stereo_at_any_opus_rate() {
        for (rate, channels, bitrate, application) in [
            (48_000u32, 2usize, 96_000, opus::Application::Audio),
            (48_000, 1, 64_000, opus::Application::Audio),
            (24_000, 2, 48_000, opus::Application::Audio),
            (16_000, 1, BITRATE, opus::Application::Voip),
        ] {
            let case = format!("{rate} Hz, {channels} channel(s)");
            // Three seconds and part of a frame, in pieces that split frames
            // and even the samples of one frame.
            let frames = rate as usize * 3 + 37;
            let audio = sweeps(rate, channels, frames);
            let mut writer =
                OpusWriter::new(Vec::new(), rate, channels as u8, bitrate, application).unwrap();
            for piece in audio.chunks(rate as usize / 10 * channels + 1) {
                writer.write(piece).unwrap();
            }
            let bytes = writer.finish().unwrap();

            let mut reader = ogg::PacketReader::new(std::io::Cursor::new(bytes.clone()));
            let head = reader.read_packet_expected().unwrap();
            assert_eq!(usize::from(head.data[9]), channels, "{case}");
            let input_rate = u32::from_le_bytes(head.data[12..16].try_into().unwrap());
            assert_eq!(input_rate, rate, "{case}");
            // The pre-skip is the encoder's look-ahead, counted at 48 kHz.
            let pre_skip = u64::from(u16::from_le_bytes([head.data[10], head.data[11]]));
            let layout = if channels == 2 {
                opus::Channels::Stereo
            } else {
                opus::Channels::Mono
            };
            let lookahead = opus::Encoder::new(rate, layout, application)
                .unwrap()
                .get_lookahead()
                .unwrap() as u64;
            let granule_per_sample = u64::from(48_000 / rate);
            assert!(lookahead > 0, "{case}");
            assert_eq!(pre_skip, lookahead * granule_per_sample, "{case}");
            reader.read_packet_expected().unwrap();
            // A page a second, each ending where the decoder's second of
            // output ends, pre-skip included; the last page ends where the
            // real audio ends.
            let (mut pages, mut last) = (0u64, None);
            while let Some(packet) = reader.read_packet().unwrap() {
                if packet.last_in_page() && !packet.last_in_stream() {
                    pages += 1;
                    assert_eq!(packet.absgp_page(), pages * 48_000, "{case}");
                }
                last = Some(packet);
            }
            assert_eq!(pages, 3, "{case}");
            let last = last.unwrap();
            assert!(last.last_in_stream(), "{case}");
            assert_eq!(
                last.absgp_page(),
                pre_skip + frames as u64 * granule_per_sample,
                "{case}"
            );

            // For the speech engine: 16 kHz mono, exactly as long, and in
            // time with the original (a stereo stream is mixed down).
            let decoded = decode(bytes.clone()).unwrap();
            assert_eq!(decoded.len(), frames * 16_000 / rate as usize, "{case}");
            let mixed: Vec<f64> = sweeps(16_000, channels, decoded.len())
                .chunks(channels)
                .map(|frame| frame.iter().map(|s| f64::from(*s)).sum::<f64>() / channels as f64)
                .collect();
            let decoded: Vec<f64> = decoded.iter().map(|s| f64::from(*s)).collect();
            // A wrong pre-skip would shift it by 104 samples (6.5 ms).
            let best = (-160..=160i64)
                .max_by(|a, b| {
                    correlation(&mixed, &decoded, *a).total_cmp(&correlation(&mixed, &decoded, *b))
                })
                .unwrap();
            assert!(best.abs() <= 2, "{case}: shifted by {best} samples");
            let similar = correlation(&mixed, &decoded, best);
            assert!(similar > 0.95, "{case}: correlation {similar}");

            // As a webview plays it: each channel keeps its own signal, in
            // time, and none of the other's.
            if channels == 2 {
                let played = decode_full_band(bytes, 2);
                let reference = sweeps(rate, 2, played.len() / 2);
                let (left, right) = (channel(&played, 2, 0), channel(&played, 2, 1));
                let (want_left, want_right) =
                    (channel(&reference, 2, 0), channel(&reference, 2, 1));
                assert!(correlation(&want_left, &left, 0) > 0.95, "{case}: left");
                assert!(correlation(&want_right, &right, 0) > 0.95, "{case}: right");
                assert!(
                    correlation(&want_right, &left, 0).abs() < 0.1,
                    "{case}: crosstalk"
                );
            }
        }
    }

    #[test]
    fn the_writer_refuses_what_opus_cannot_take() {
        for (rate, channels) in [(44_100, 2), (96_000, 2), (48_000, 0), (48_000, 3)] {
            assert!(
                OpusWriter::new(Vec::new(), rate, channels, 96_000, opus::Application::Audio)
                    .is_err(),
                "{rate} Hz, {channels} channels"
            );
        }
    }

    /// Where each Ogg page starts, from the page headers.
    fn page_starts(bytes: &[u8]) -> Vec<usize> {
        let mut starts = Vec::new();
        let mut at = 0;
        while at + 27 <= bytes.len() {
            assert_eq!(&bytes[at..at + 4], b"OggS");
            starts.push(at);
            let segments = usize::from(bytes[at + 26]);
            let lacing = &bytes[at + 27..(at + 27 + segments).min(bytes.len())];
            at += 27 + segments + lacing.iter().map(|size| usize::from(*size)).sum::<usize>();
        }
        starts
    }

    #[test]
    fn a_recording_cut_off_by_a_crash_plays_up_to_its_last_page() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("1-1.hq.opus");
        let mut writer =
            OpusWriter::create(&path, 48_000, 2, 96_000, opus::Application::Audio).unwrap();
        // 3.5 s in half-second pieces, as a recording receives them.
        for piece in sweeps(48_000, 2, 48_000 * 7 / 2).chunks(48_000) {
            writer.write(piece).unwrap();
        }
        // The app stops here: the stream is never ended, and what reached
        // the file is all there is.
        let on_disk = fs::read(&path).unwrap();
        drop(writer);
        assert!(fs::read(&path).unwrap() == on_disk);
        // Headers, then a page for each whole second.
        let pages = page_starts(&on_disk);
        assert_eq!(pages.len(), 2 + 3);
        // The decoder's delay: the end of a page's audio comes out with the
        // packets of the next one.
        let head = Samples::open(std::io::Cursor::new(on_disk.clone())).unwrap();
        let delay = (head.pre_skip / GRANULE_PER_SAMPLE) as usize;
        assert!(delay > 0);

        // Three whole seconds reached the file.
        assert_eq!(decode(on_disk.clone()).unwrap().len(), 3 * 16_000 - delay);
        // Cut inside the last page, it plays up to the page before.
        let cut = on_disk[..on_disk.len() - 100].to_vec();
        assert_eq!(decode(cut).unwrap().len(), 2 * 16_000 - delay);
        // Cut inside the header of the last page: the same.
        let cut = on_disk[..pages[4] + 10].to_vec();
        assert_eq!(decode(cut).unwrap().len(), 2 * 16_000 - delay);
        // Cut inside the first page of audio, there is nothing to play.
        let cut = on_disk[..pages[2] + 100].to_vec();
        assert_eq!(decode(cut).unwrap_err(), INVALID);
        // Played from the file, as transcribing it again would.
        fs::write(&path, &on_disk[..on_disk.len() - 100]).unwrap();
        assert_eq!(open(&path).unwrap().count(), 2 * 16_000 - delay);
    }

    /// A WAV recording as a hard stop leaves it: the header counts `counted`
    /// samples, and every sample of `audio` reached the file.
    fn interrupted_wav(path: &Path, counted: u64, audio: &[i16]) {
        let mut bytes = crate::streaming::wav_header(counted).to_vec();
        bytes.extend(audio.iter().flat_map(|sample| sample.to_le_bytes()));
        fs::write(path, bytes).unwrap();
    }

    fn set_modified(path: &Path, time: std::time::SystemTime) {
        File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(time))
            .unwrap();
    }

    fn samples_counted(bytes: Vec<u8>) -> usize {
        hound::WavReader::new(std::io::Cursor::new(bytes))
            .unwrap()
            .duration() as usize
    }

    #[test]
    fn a_stale_wav_header_is_brought_up_to_date() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("1-1.wav");
        let audio = speech(4.0);
        // Four seconds on disk with the header written when recording began,
        // and half a sample from a write cut short.
        interrupted_wav(&path, 0, &audio);
        File::options()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(&[7])
            .unwrap();
        let recorded = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        set_modified(&path, recorded);
        assert_eq!(hound::WavReader::open(&path).unwrap().duration(), 0);

        assert!(repair_wav_header(&path).unwrap());
        let mut reader = hound::WavReader::open(&path).unwrap();
        assert_eq!(reader.duration() as usize, audio.len());
        let read: Vec<i16> = reader.samples::<i16>().map(Result::unwrap).collect();
        assert_eq!(read, audio);
        drop(reader);
        // No audio is cut, and the file keeps its time, which retention and
        // a recording without its record go by.
        let metadata = fs::metadata(&path).unwrap();
        assert_eq!(metadata.len(), 44 + audio.len() as u64 * 2 + 1);
        assert_eq!(metadata.modified().unwrap(), recorded);
        // Up to date now.
        assert!(!repair_wav_header(&path).unwrap());

        // Synced at five seconds, with nine on disk.
        let audio = speech(9.0);
        interrupted_wav(&path, 5 * 16_000, &audio);
        assert!(repair_wav_header(&path).unwrap());
        assert_eq!(samples_counted(fs::read(&path).unwrap()), audio.len());
    }

    #[test]
    fn a_valid_or_unknown_wav_header_is_left_alone() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("2-1.wav");
        let unchanged = |bytes: &[u8]| {
            fs::write(&path, bytes).unwrap();
            assert!(!repair_wav_header(&path).unwrap());
            assert!(fs::read(&path).unwrap() == bytes);
            assert!(read_whole_wav(&path).unwrap() == bytes);
        };
        // Up to date.
        unchanged(&crate::streaming::wav_bytes(&speech(1.0)));
        // Counts more than the file holds (cut short): never lowered.
        let mut short = crate::streaming::wav_bytes(&speech(1.0));
        short.truncate(10_000);
        unchanged(&short);
        // Shorter than a header, and not a WAV at all.
        unchanged(b"RIFF");
        unchanged(&[0; 200]);
        // Not the format this app records, though it holds more than it says.
        let mut stereo = crate::streaming::wav_header(0).to_vec();
        stereo[22..24].copy_from_slice(&2u16.to_le_bytes());
        stereo.extend_from_slice(&[1; 3200]);
        unchanged(&stereo);
        // A format chunk this app does not write: the data is elsewhere.
        let mut other = crate::streaming::wav_header(0).to_vec();
        other[16..20].copy_from_slice(&18u32.to_le_bytes());
        other.splice(36..36, [0, 0]);
        other.extend_from_slice(&[1; 3200]);
        unchanged(&other);
        // Another chunk after the data: its bytes are not audio.
        let mut tagged = crate::streaming::wav_bytes(&speech(0.5));
        let riff = u32::from_le_bytes(tagged[4..8].try_into().unwrap()) + 12;
        tagged[4..8].copy_from_slice(&riff.to_le_bytes());
        tagged.extend_from_slice(b"LIST\x04\x00\x00\x00INFO");
        unchanged(&tagged);

        // As much as a WAV header can count, in whole samples.
        let mut header = crate::streaming::wav_header(0);
        assert!(update_wav_sizes(&mut header, 5_000_000_000));
        assert_eq!(&header[4..8], &4_294_967_294u32.to_le_bytes());
        assert_eq!(&header[40..44], &4_294_967_258u32.to_le_bytes());
    }

    #[test]
    fn a_stale_wav_header_is_counted_in_full_even_when_it_cannot_be_written() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("3-1.wav");
        let audio = speech(3.0);
        // Synced at one second, with three on disk.
        interrupted_wav(&path, 16_000, &audio);
        let on_disk = fs::read(&path).unwrap();
        // What every reader falls back to when the header on disk cannot be
        // brought up to date: the file is read as it is, and counted whole.
        let mut reader = read_wav(&path).unwrap();
        assert_eq!(reader.duration() as usize, audio.len());
        let read: Vec<i16> = reader.samples::<i16>().map(Result::unwrap).collect();
        assert_eq!(read, audio);
        assert_eq!(samples_counted(read_whole_wav(&path).unwrap()), audio.len());
        assert!(fs::read(&path).unwrap() == on_disk);
        // `open_wav` also brings the file itself up to date.
        assert_eq!(open_wav(&path).unwrap().duration() as usize, audio.len());
        assert_eq!(samples_counted(fs::read(&path).unwrap()), audio.len());
    }

    #[test]
    fn compressing_counts_what_a_crash_left_uncounted() {
        let folder = tempfile::tempdir().unwrap();
        let audio = speech(4.0);
        interrupted_wav(&folder.path().join("2-1.wav"), 0, &audio);
        assert!(compress(folder.path(), "2-1").unwrap() > 0);
        assert!(!folder.path().join("2-1.wav").exists());
        assert_eq!(
            open(&folder.path().join("2-1.opus")).unwrap().count(),
            audio.len()
        );
    }

    #[test]
    fn an_existing_opus_file_is_never_encoded_again() {
        let folder = tempfile::tempdir().unwrap();
        let stereo = |frames: usize| {
            let mut writer =
                OpusWriter::new(Vec::new(), 48_000, 2, 96_000, opus::Application::Audio).unwrap();
            writer.write(&sweeps(48_000, 2, frames)).unwrap();
            writer.finish().unwrap()
        };
        // A high-quality file made while recording, and the 16 kHz WAV of the
        // same recording that an interruption left next to it.
        let hq = stereo(48_000 * 2);
        fs::write(folder.path().join("5-1.opus"), &hq).unwrap();
        let wav = crate::streaming::wav_bytes(&sweeps(16_000, 1, 16_000 * 2));
        fs::write(folder.path().join("5-1.wav"), &wav).unwrap();
        assert_eq!(compress(folder.path(), "5-1").unwrap(), wav.len() as u64);
        assert!(fs::read(folder.path().join("5-1.opus")).unwrap() == hq);
        assert!(!folder.path().join("5-1.wav").exists());
        assert!(!folder.path().join("5-1.opus.tmp").exists());

        // An Opus file that holds less than the WAV keeps the WAV.
        let short = stereo(48_000);
        fs::write(folder.path().join("6-1.opus"), &short).unwrap();
        fs::write(folder.path().join("6-1.wav"), &wav).unwrap();
        assert!(compress(folder.path(), "6-1").is_err());
        assert!(fs::read(folder.path().join("6-1.opus")).unwrap() == short);
        assert!(fs::read(folder.path().join("6-1.wav")).unwrap() == wav);
        // So does one that cannot be read.
        fs::write(folder.path().join("6-1.opus"), b"OggS").unwrap();
        assert!(compress(folder.path(), "6-1").is_err());
        assert!(fs::read(folder.path().join("6-1.opus")).unwrap() == b"OggS");
        assert!(fs::read(folder.path().join("6-1.wav")).unwrap() == wav);
        // In a pass over every recording, it counts as not compressed.
        let done = compress_all(folder.path()).unwrap();
        assert_eq!((done.recordings, done.failed), (0, 1));
    }

    #[test]
    fn playback_gets_the_opus_file_itself_or_wav() {
        let folder = tempfile::tempdir().unwrap();
        let samples = speech(3.0);
        let wav = crate::streaming::wav_bytes(&samples);
        fs::write(folder.path().join("6-1.wav"), &wav).unwrap();
        // Not compressed: WAV, whatever is asked.
        for prefer_ogg in [true, false] {
            assert!(read_for_playback(folder.path(), "6-1", prefer_ogg).unwrap() == wav);
        }
        compress(folder.path(), "6-1").unwrap();
        let opus = fs::read(folder.path().join("6-1.opus")).unwrap();
        assert!(read_for_playback(folder.path(), "6-1", true).unwrap() == opus);
        let decoded = read_for_playback(folder.path(), "6-1", false).unwrap();
        let reader = hound::WavReader::new(std::io::Cursor::new(decoded)).unwrap();
        assert_eq!(reader.spec().sample_rate, 16_000);
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.duration() as usize, samples.len());

        // A high-quality stereo file: itself, or 16 kHz mono WAV.
        let mut writer =
            OpusWriter::new(Vec::new(), 48_000, 2, 96_000, opus::Application::Audio).unwrap();
        writer.write(&sweeps(48_000, 2, 48_000)).unwrap();
        let hq = writer.finish().unwrap();
        fs::write(folder.path().join("7-1.opus"), &hq).unwrap();
        assert!(read_for_playback(folder.path(), "7-1", true).unwrap() == hq);
        let decoded = read_for_playback(folder.path(), "7-1", false).unwrap();
        let reader = hound::WavReader::new(std::io::Cursor::new(decoded)).unwrap();
        assert_eq!(
            (reader.spec().sample_rate, reader.spec().channels),
            (16_000, 1)
        );
        assert_eq!(reader.duration(), 16_000);
    }

    #[test]
    fn playback_counts_what_a_crash_left_uncounted() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("7-1.wav");
        let audio = speech(2.0);
        interrupted_wav(&path, 0, &audio);
        let played = read_for_playback(folder.path(), "7-1", true).unwrap();
        assert_eq!(samples_counted(played.clone()), audio.len());
        assert_eq!(played.len(), 44 + audio.len() * 2);
        // The file itself was brought up to date.
        assert_eq!(samples_counted(fs::read(&path).unwrap()), audio.len());
    }

    /// The e2e suite plays `tone.opus` as a compressed recording: it is
    /// `tone.wav` compressed by `compress`. With SONOLECT_WRITE_FIXTURES set,
    /// this test writes it again.
    #[test]
    fn the_e2e_opus_fixture_is_a_compressed_recording() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../e2e/fixtures");
        let wav = fs::read(fixtures.join("tone.wav")).unwrap();
        if std::env::var_os("SONOLECT_WRITE_FIXTURES").is_some() {
            let folder = tempfile::tempdir().unwrap();
            fs::write(folder.path().join("1-1.wav"), &wav).unwrap();
            compress(folder.path(), "1-1").unwrap();
            fs::copy(folder.path().join("1-1.opus"), fixtures.join("tone.opus")).unwrap();
        }
        let samples = samples_counted(wav);
        let opus = fs::read(fixtures.join("tone.opus")).unwrap();
        // Written as the app writes files now.
        assert_granules_follow_the_audio(opus.clone(), SAMPLE_RATE, samples, "tone.opus");
        let mut reader = ogg::PacketReader::new(std::io::Cursor::new(opus.clone()));
        let head = reader.read_packet_expected().unwrap();
        assert_eq!(&head.data[..8], b"OpusHead");
        assert_eq!(head.data[9], 1);
        assert_eq!(
            u32::from_le_bytes(head.data[12..16].try_into().unwrap()),
            SAMPLE_RATE
        );
        assert_eq!(decode(opus).unwrap().len(), samples);
    }
}
