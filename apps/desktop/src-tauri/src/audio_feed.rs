//! Audio that reaches a recording from a native source instead of the
//! webview's microphone: the shapes a source hands over, the conversion to
//! the speech engine's format, and the loop that keeps the recording in step
//! with the clock. Nothing here touches a device, so all of it is tested.
use std::{io::Read, time::Duration};

/// The speech engine's sample rate.
pub const SAMPLE_RATE: u32 = 16_000;

/// Silence is filled in once a recording trails the clock by this much.
/// WASAPI loopback hands over nothing at all while nothing is playing, so a
/// pause in a meeting would otherwise vanish from the recording and every
/// later timestamp would be early.
const GAP_SAMPLES: u64 = SAMPLE_RATE as u64;

/// What a source hands over each time it is asked.
pub enum Feed {
    /// 16 kHz mono samples.
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
}

/// Turns interleaved samples at a device's rate and channel count into
/// 16 kHz mono. Each output sample is the average of the input it spans,
/// which also keeps most of what is above 8 kHz from folding back into
/// speech.
pub struct ToSpeech {
    channels: usize,
    /// Input frames per output sample.
    step: f64,
    sum: f64,
    filled: f64,
    frame: Vec<f32>,
}

// Only the Windows recorder converts: the others ask their recorder process
// for the speech engine's format.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
impl ToSpeech {
    pub fn new(sample_rate: u32, channels: u16) -> Result<Self, String> {
        if sample_rate == 0 || channels == 0 {
            return Err("The playback device reports no audio format.".into());
        }
        Ok(Self {
            channels: channels as usize,
            step: f64::from(sample_rate) / f64::from(SAMPLE_RATE),
            sum: 0.0,
            filled: 0.0,
            frame: Vec::with_capacity(channels as usize),
        })
    }

    /// Output samples to expect from `interleaved` input samples.
    pub fn capacity(&self, interleaved: usize) -> usize {
        ((interleaved / self.channels) as f64 / self.step) as usize + 1
    }

    /// Adds interleaved samples in -1.0..=1.0. A frame split across two
    /// calls is carried over.
    pub fn push(&mut self, interleaved: impl IntoIterator<Item = f32>, out: &mut Vec<i16>) {
        for sample in interleaved {
            self.frame.push(sample);
            if self.frame.len() < self.channels {
                continue;
            }
            let mono = f64::from(self.frame.iter().sum::<f32>()) / self.channels as f64;
            self.frame.clear();
            let mut left = 1.0;
            while self.filled + left >= self.step {
                let take = self.step - self.filled;
                self.sum += mono * take;
                let value = (self.sum / self.step).clamp(-1.0, 1.0);
                out.push((value * f64::from(i16::MAX)).round() as i16);
                self.sum = 0.0;
                self.filled = 0.0;
                left -= take;
            }
            self.sum += mono * left;
            self.filled += left;
        }
    }
}

/// Samples of silence to add before `incoming` new samples, so that the
/// recording is as long as the time that has passed. Zero while the
/// recording trails the clock by less than a second.
pub fn gap(elapsed: Duration, delivered: u64, incoming: usize) -> usize {
    let due = (elapsed.as_millis() as u64).saturating_mul(u64::from(SAMPLE_RATE)) / 1000;
    let missing = due.saturating_sub(delivered.saturating_add(incoming as u64));
    if missing >= GAP_SAMPLES {
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
/// Returns what went wrong, if anything did.
pub fn pump(
    source: &mut dyn Source,
    elapsed: impl Fn() -> Duration,
    mut sink: impl FnMut(&[i16]) -> Result<(), String>,
) -> Option<String> {
    let mut delivered: u64 = 0;
    loop {
        let (audio, ended) = match source.next() {
            Feed::Audio(audio) => (audio, None),
            Feed::Quiet => (Vec::new(), None),
            Feed::Ended(reason) => (Vec::new(), Some(reason)),
        };
        let silence = gap(elapsed(), delivered, audio.len());
        if silence > 0 {
            if let Err(message) = sink(&vec![0; silence]) {
                return Some(message);
            }
            delivered += silence as u64;
        }
        if !audio.is_empty() {
            if let Err(message) = sink(&audio) {
                return Some(message);
            }
            delivered += audio.len() as u64;
        }
        if let Some(reason) = ended {
            return reason;
        }
    }
}

/// 16 kHz mono 16-bit little-endian audio read from a pipe: the output of a
/// recorder process. A sample split across two reads is carried over.
pub struct Piped<R> {
    reader: R,
    carry: Option<u8>,
}

impl<R: Read> Piped<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            carry: None,
        }
    }
}

impl<R: Read> Source for Piped<R> {
    fn next(&mut self) -> Feed {
        // A fifth of a second of audio.
        let mut buffer = [0u8; 6400];
        let read = match self.reader.read(&mut buffer) {
            Ok(0) => return Feed::Ended(None),
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => return Feed::Quiet,
            Err(error) => return Feed::Ended(Some(format!("System audio stopped: {error}"))),
        };
        let mut bytes = Vec::with_capacity(read + 1);
        bytes.extend(self.carry.take());
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() % 2 == 1 {
            self.carry = bytes.pop();
        }
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, collections::VecDeque, io::Cursor};

    fn tone(rate: u32, hz: f64, seconds: f64) -> Vec<f32> {
        (0..(f64::from(rate) * seconds) as usize)
            .map(|i| (i as f64 * hz * std::f64::consts::TAU / f64::from(rate)).sin() as f32 * 0.5)
            .collect()
    }

    fn rms(samples: &[i16]) -> f64 {
        (samples
            .iter()
            .map(|s| f64::from(*s) * f64::from(*s))
            .sum::<f64>()
            / samples.len() as f64)
            .sqrt()
    }

    #[test]
    fn converts_common_device_rates_to_the_speech_rate() {
        for rate in [44_100, 48_000, 96_000, 16_000] {
            let mut convert = ToSpeech::new(rate, 1).unwrap();
            let mut out = Vec::new();
            convert.push(tone(rate, 440.0, 2.0), &mut out);
            let expected = 2 * SAMPLE_RATE as i64;
            assert!(
                (out.len() as i64 - expected).abs() <= 1,
                "{rate} Hz gave {} samples",
                out.len()
            );
            // A 0.5 amplitude tone keeps its level (RMS 0.5/√2 of full scale).
            let level = rms(&out) / f64::from(i16::MAX);
            assert!((level - 0.3536).abs() < 0.02, "{rate} Hz level {level}");
        }
    }

    #[test]
    fn mixes_channels_and_carries_a_split_frame() {
        let mut convert = ToSpeech::new(SAMPLE_RATE, 2).unwrap();
        let mut out = Vec::new();
        // Left 0.5, right -0.5 cancel; the second frame arrives in two calls.
        convert.push([0.5, -0.5, 0.25], &mut out);
        assert_eq!(out, [0]);
        convert.push([0.75], &mut out);
        assert_eq!(out, [0, (0.5 * f64::from(i16::MAX)).round() as i16]);
    }

    #[test]
    fn keeps_out_what_is_above_the_speech_band() {
        // 15 kHz at 48 kHz would fold to 1 kHz if samples were just dropped.
        let mut convert = ToSpeech::new(48_000, 1).unwrap();
        let mut high = Vec::new();
        convert.push(tone(48_000, 15_000.0, 1.0), &mut high);
        let mut convert = ToSpeech::new(48_000, 1).unwrap();
        let mut voice = Vec::new();
        convert.push(tone(48_000, 300.0, 1.0), &mut voice);
        assert!(rms(&high) < rms(&voice) / 4.0);
    }

    #[test]
    fn clamps_loud_input_and_rejects_an_empty_format() {
        let mut convert = ToSpeech::new(SAMPLE_RATE, 1).unwrap();
        let mut out = Vec::new();
        convert.push([4.0, -4.0], &mut out);
        assert_eq!(out, [i16::MAX, -i16::MAX]);
        assert!(ToSpeech::new(0, 2).is_err());
        assert!(ToSpeech::new(48_000, 0).is_err());
    }

    #[test]
    fn fills_silence_only_when_the_recording_trails_the_clock() {
        let second = SAMPLE_RATE as usize;
        assert_eq!(gap(Duration::from_millis(900), 0, 0), 0);
        assert_eq!(gap(Duration::from_secs(1), 0, 0), second);
        // Audio that just arrived counts as recorded.
        assert_eq!(gap(Duration::from_secs(3), second as u64, second), second);
        assert_eq!(gap(Duration::from_secs(2), second as u64, second), 0);
        // Ahead of the clock: nothing to add.
        assert_eq!(gap(Duration::from_secs(1), 5 * second as u64, 0), 0);
    }

    #[test]
    fn measures_the_loudest_sample() {
        assert_eq!(peak(&[]), 0.0);
        assert_eq!(peak(&[0, -16384, 100]), 16384.0 / 32767.0);
        assert_eq!(peak(&[i16::MIN]), 32768.0 / 32767.0);
    }

    struct Script(VecDeque<Feed>);

    impl Source for Script {
        fn next(&mut self) -> Feed {
            self.0.pop_front().unwrap_or(Feed::Ended(None))
        }
    }

    #[test]
    fn pump_keeps_the_recording_as_long_as_the_time_that_passed() {
        let second = SAMPLE_RATE as usize;
        let mut source = Script(VecDeque::from([
            Feed::Audio(vec![7; second]),
            // Nothing played for three seconds.
            Feed::Quiet,
            Feed::Quiet,
            Feed::Audio(vec![9; second]),
            Feed::Ended(None),
        ]));
        // The clock at each call: 1 s, 2 s, 4 s, 5 s, 5 s.
        let clock = [1, 2, 4, 5, 5];
        let call = Cell::new(0);
        let mut recorded: Vec<i16> = Vec::new();
        let ended = pump(
            &mut source,
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
        assert_eq!(ended, None);
        assert_eq!(recorded.len(), 5 * second);
        assert!(recorded[..second].iter().all(|s| *s == 7));
        assert!(recorded[second..4 * second].iter().all(|s| *s == 0));
        assert!(recorded[4 * second..].iter().all(|s| *s == 9));
    }

    #[test]
    fn pump_stops_when_the_recording_refuses_and_reports_a_failed_source() {
        let mut source = Script(VecDeque::from([
            Feed::Audio(vec![1; 10]),
            Feed::Audio(vec![2; 10]),
        ]));
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

        let mut source = Script(VecDeque::from([Feed::Ended(Some("unplugged".into()))]));
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

    #[test]
    fn reads_piped_samples_even_when_one_is_split_across_reads() {
        let samples: Vec<i16> = vec![1, -2, 300, -400, i16::MAX, i16::MIN];
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut source = Piped::new(Trickle(Cursor::new(bytes), 3));
        let mut read = Vec::new();
        loop {
            match source.next() {
                Feed::Audio(audio) => read.extend(audio),
                Feed::Quiet => {}
                Feed::Ended(reason) => {
                    assert_eq!(reason, None);
                    break;
                }
            }
        }
        assert_eq!(read, samples);
    }
}
