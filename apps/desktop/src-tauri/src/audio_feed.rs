//! Audio that reaches a recording from a native source instead of the
//! webview's microphone: the shape a source hands it over in, and the loop
//! that keeps the recording in step with the clock. A source hands over
//! interleaved 16-bit frames in its own format; the recording converts them
//! (see `resample::Converter`). Nothing here touches a device, so all of it
//! is tested.
use std::{io::Read, time::Duration};

use super::resample::PcmFormat;

/// What a source hands over each time it is asked.
pub enum Feed {
    /// Interleaved frames in the source's format.
    Audio(Vec<i16>),
    /// Nothing arrived in the last moment. The source is still open.
    Quiet,
    /// The source closed, with what went wrong unless it was asked to.
    Ended(Option<String>),
}

/// A native source of audio. `next` waits a short while at most, so the
/// loop that reads it notices a stop quickly.
pub trait Source {
    fn next(&mut self) -> Feed;
    /// The rate and channels of what `next` hands over. It never changes.
    fn format(&self) -> PcmFormat;
}

/// Frames of silence to add before `incoming` new frames, so that the
/// recording is as long as the time that has passed. Zero while the
/// recording trails the clock by less than a second. Silence is filled in
/// once the recording trails by that much: WASAPI loopback hands over
/// nothing at all while nothing is playing, so a pause in a meeting would
/// otherwise vanish from the recording and every later timestamp would be
/// early.
pub fn gap(elapsed: Duration, rate: u32, delivered: u64, incoming: usize) -> usize {
    let due = (elapsed.as_millis() as u64).saturating_mul(u64::from(rate)) / 1000;
    let missing = due.saturating_sub(delivered.saturating_add(incoming as u64));
    if missing >= u64::from(rate) {
        missing as usize
    } else {
        0
    }
}

/// The loudest sample of a block, 0.0 to 1.0.
pub fn peak(samples: &[i16]) -> f32 {
    let loudest = samples
        .iter()
        .map(|sample| sample.unsigned_abs())
        .max()
        .unwrap_or(0);
    f32::from(loudest) / f32::from(i16::MAX)
}

/// Feeds `sink` from `source` until the source ends or the sink refuses.
/// The sink gets interleaved frames in the source's format. Returns what
/// went wrong, if anything did.
pub fn pump(
    source: &mut dyn Source,
    elapsed: impl Fn() -> Duration,
    mut sink: impl FnMut(&[i16]) -> Result<(), String>,
) -> Option<String> {
    let format = source.format();
    let channels = usize::from(format.channels);
    let mut delivered: u64 = 0;
    loop {
        let (audio, ended) = match source.next() {
            Feed::Audio(audio) => (audio, None),
            Feed::Quiet => (Vec::new(), None),
            Feed::Ended(reason) => (Vec::new(), Some(reason)),
        };
        let frames = audio.len() / channels;
        let silence = gap(elapsed(), format.rate, delivered, frames);
        if silence > 0 {
            if let Err(message) = sink(&vec![0; silence * channels]) {
                return Some(message);
            }
            delivered += silence as u64;
        }
        if !audio.is_empty() {
            if let Err(message) = sink(&audio) {
                return Some(message);
            }
            delivered += frames as u64;
        }
        if let Some(reason) = ended {
            return reason;
        }
    }
}

/// 16-bit little-endian audio read from a pipe, the output of a recorder
/// process, in the format it was asked for. A frame split across two reads
/// is carried over to the next.
pub struct Piped<R> {
    reader: R,
    format: PcmFormat,
    carry: Vec<u8>,
}

impl<R: Read> Piped<R> {
    pub fn new(reader: R, format: PcmFormat) -> Self {
        Self {
            reader,
            format,
            carry: Vec::new(),
        }
    }
}

impl<R: Read> Source for Piped<R> {
    fn next(&mut self) -> Feed {
        // A fifth of a second of 16 kHz mono; a twentieth at 48 kHz stereo.
        let mut buffer = [0u8; 6400];
        let read = match self.reader.read(&mut buffer) {
            Ok(0) => return Feed::Ended(None),
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => return Feed::Quiet,
            Err(error) => return Feed::Ended(Some(format!("System audio stopped: {error}"))),
        };
        let mut bytes = std::mem::take(&mut self.carry);
        bytes.extend_from_slice(&buffer[..read]);
        let frame = 2 * usize::from(self.format.channels);
        let whole = bytes.len() - bytes.len() % frame;
        self.carry = bytes.split_off(whole);
        if bytes.is_empty() {
            return Feed::Quiet;
        }
        Feed::Audio(
            bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| i16::from_le_bytes(*pair))
                .collect(),
        )
    }

    fn format(&self) -> PcmFormat {
        self.format
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, collections::VecDeque, io::Cursor};

    #[test]
    fn fills_silence_only_when_the_recording_trails_the_clock() {
        for rate in [16_000u32, 44_100, 48_000] {
            let second = rate as usize;
            assert_eq!(gap(Duration::from_millis(900), rate, 0, 0), 0);
            assert_eq!(gap(Duration::from_secs(1), rate, 0, 0), second);
            // Audio that just arrived counts as recorded.
            assert_eq!(
                gap(Duration::from_secs(3), rate, second as u64, second),
                second
            );
            assert_eq!(gap(Duration::from_secs(2), rate, second as u64, second), 0);
            // Ahead of the clock: nothing to add.
            assert_eq!(gap(Duration::from_secs(1), rate, 5 * second as u64, 0), 0);
        }
    }

    #[test]
    fn measures_the_loudest_sample() {
        assert_eq!(peak(&[]), 0.0);
        assert_eq!(peak(&[0, -16384, 100]), 16384.0 / 32767.0);
        assert_eq!(peak(&[i16::MIN]), 32768.0 / 32767.0);
    }

    struct Script(VecDeque<Feed>, PcmFormat);

    impl Source for Script {
        fn next(&mut self) -> Feed {
            self.0.pop_front().unwrap_or(Feed::Ended(None))
        }

        fn format(&self) -> PcmFormat {
            self.1
        }
    }

    fn run(source: &mut Script, clock: &[u64]) -> (Option<String>, Vec<i16>) {
        let call = Cell::new(0);
        let mut recorded: Vec<i16> = Vec::new();
        let ended = pump(
            source,
            || {
                let now = Duration::from_secs(clock[call.get()]);
                call.set(call.get() + 1);
                now
            },
            |audio| {
                recorded.extend_from_slice(audio);
                Ok(())
            },
        );
        (ended, recorded)
    }

    #[test]
    fn pump_keeps_the_recording_as_long_as_the_time_that_passed() {
        let second = 16_000;
        let mut source = Script(
            VecDeque::from([
                Feed::Audio(vec![7; second]),
                // Nothing played for three seconds.
                Feed::Quiet,
                Feed::Quiet,
                Feed::Audio(vec![9; second]),
                Feed::Ended(None),
            ]),
            PcmFormat::SPEECH,
        );
        // The clock at each call: 1 s, 2 s, 4 s, 5 s, 5 s.
        let (ended, recorded) = run(&mut source, &[1, 2, 4, 5, 5]);
        assert_eq!(ended, None);
        assert_eq!(recorded.len(), 5 * second);
        assert!(recorded[..second].iter().all(|s| *s == 7));
        assert!(recorded[second..4 * second].iter().all(|s| *s == 0));
        assert!(recorded[4 * second..].iter().all(|s| *s == 9));
    }

    #[test]
    fn pump_counts_frames_at_the_source_rate_and_fills_whole_frames() {
        // 48 kHz stereo: a second is 48,000 frames, 96,000 samples.
        let format = PcmFormat::new(48_000, 2).unwrap();
        let second = 2 * 48_000;
        let mut source = Script(
            VecDeque::from([
                Feed::Audio(vec![7; second]),
                Feed::Quiet,
                Feed::Audio(vec![9; second / 2]),
                Feed::Ended(None),
            ]),
            format,
        );
        // 1 s, then 3 s: two seconds of silence; then half a second.
        let (ended, recorded) = run(&mut source, &[1, 3, 3, 3]);
        assert_eq!(ended, None);
        assert_eq!(recorded.len(), 3 * second + second / 2);
        assert!(recorded[second..3 * second].iter().all(|s| *s == 0));
        assert!(recorded[3 * second..].iter().all(|s| *s == 9));
    }

    #[test]
    fn pump_stops_when_the_recording_refuses_and_reports_a_failed_source() {
        let mut source = Script(
            VecDeque::from([Feed::Audio(vec![1; 10]), Feed::Audio(vec![2; 10])]),
            PcmFormat::SPEECH,
        );
        let mut calls = 0;
        let ended = pump(
            &mut source,
            || Duration::ZERO,
            |_| {
                calls += 1;
                if calls == 2 {
                    Err("The recording reached the four-hour limit.".into())
                } else {
                    Ok(())
                }
            },
        );
        assert_eq!(
            ended.as_deref(),
            Some("The recording reached the four-hour limit.")
        );

        let mut source = Script(
            VecDeque::from([Feed::Ended(Some("unplugged".into()))]),
            PcmFormat::SPEECH,
        );
        let ended = pump(&mut source, || Duration::ZERO, |_| Ok(()));
        assert_eq!(ended.as_deref(), Some("unplugged"));
    }

    /// Hands out its bytes a few at a time, like a pipe.
    struct Trickle(Cursor<Vec<u8>>, usize);

    impl Read for Trickle {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let limit = self.1.min(buffer.len());
            self.0.read(&mut buffer[..limit])
        }
    }

    fn read_all(source: &mut Piped<Trickle>) -> Vec<Vec<i16>> {
        let mut pieces = Vec::new();
        loop {
            match source.next() {
                Feed::Audio(audio) => pieces.push(audio),
                Feed::Quiet => {}
                Feed::Ended(reason) => {
                    assert_eq!(reason, None);
                    return pieces;
                }
            }
        }
    }

    #[test]
    fn reads_piped_samples_even_when_one_is_split_across_reads() {
        let samples: Vec<i16> = vec![1, -2, 300, -400, i16::MAX, i16::MIN];
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut source = Piped::new(Trickle(Cursor::new(bytes), 3), PcmFormat::SPEECH);
        assert_eq!(read_all(&mut source).concat(), samples);
    }

    #[test]
    fn reads_piped_stereo_in_whole_frames_whatever_each_read_holds() {
        let format = PcmFormat::new(48_000, 2).unwrap();
        let samples: Vec<i16> = (0..2 * 1000).map(|i| i as i16 - 1000).collect();
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        // Odd byte counts: frames (4 bytes) and samples are split across reads.
        for size in [1, 3, 5, 7, 4095] {
            let mut source = Piped::new(Trickle(Cursor::new(bytes.clone()), size), format);
            assert_eq!(source.format(), format);
            let pieces = read_all(&mut source);
            assert!(pieces.iter().all(|piece| piece.len() % 2 == 0), "{size}");
            assert_eq!(pieces.concat(), samples, "{size}");
        }
    }
}
