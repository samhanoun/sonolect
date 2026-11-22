//! Live audio brought to the rates and channel counts a recording keeps.
//!
//! A recording arrives at whatever its source delivers: a microphone at
//! 48 kHz, a playback device at 44.1 kHz in stereo or 5.1, a recorder
//! process at 16 kHz mono. The speech engine works with 16 kHz mono, and a
//! high-quality copy is kept at 48 kHz, the rate Opus encodes at. Both come
//! out of one `Converter`, which takes pieces of any size and gives out
//! exactly as much audio as the input's length calls for. Nothing here
//! touches a device, so all of the conversion is tested on every platform;
//! the platform files only change sample formats.
use audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Indexing, Resampler};

/// What the speech engine works with.
pub const SPEECH_RATE: u32 = 16_000;
/// What a high-quality copy is kept at: the rate Opus encodes at.
pub const HIGH_RATE: u32 = 48_000;
/// The rates a source may deliver.
pub const MIN_RATE: u32 = 8_000;
pub const MAX_RATE: u32 = 384_000;
/// The most channels a source may deliver (7.1 and more).
pub const MAX_CHANNELS: u16 = 16;

/// The shape of interleaved 16-bit audio: its rate and channel count.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PcmFormat {
    pub rate: u32,
    pub channels: u16,
}

impl PcmFormat {
    /// 16 kHz mono: what a speech-quality recording has always sent.
    pub const SPEECH: Self = Self {
        rate: SPEECH_RATE,
        channels: 1,
    };

    pub fn new(rate: u32, channels: u16) -> Result<Self, String> {
        if !(MIN_RATE..=MAX_RATE).contains(&rate) || !(1..=MAX_CHANNELS).contains(&channels) {
            return Err(INVALID_FORMAT.into());
        }
        Ok(Self { rate, channels })
    }
}

pub const INVALID_FORMAT: &str = "Invalid audio rate or channel count.";

fn resample_error(error: impl std::fmt::Display) -> String {
    format!("Cannot convert the audio: {error}")
}

/// Changes the rate of a stream of interleaved samples, piece by piece.
///
/// The resampler's own delay is cut from the start, and `finish` pushes out
/// what it still holds, so the output lines up with the input sample for
/// sample and is exactly `length_for(input)` frames long.
pub struct StreamResampler {
    /// `None` when the rates are the same: the audio passes as it is.
    fft: Option<Fft<f32>>,
    channels: usize,
    rate_in: u64,
    rate_out: u64,
    /// Input not resampled yet: less than one step of it.
    pending: Vec<f32>,
    scratch: Vec<f32>,
    /// Output frames of the resampler's delay still to drop.
    to_trim: usize,
    /// Input frames taken so far.
    taken: u64,
    /// Output frames given out so far.
    given: u64,
}

impl StreamResampler {
    pub fn new(rate_in: u32, rate_out: u32, channels: usize) -> Result<Self, String> {
        let valid = |rate: u32| (MIN_RATE..=MAX_RATE).contains(&rate);
        if !valid(rate_in) || !valid(rate_out) || channels == 0 {
            return Err(INVALID_FORMAT.into());
        }
        let fft = if rate_in == rate_out {
            None
        } else {
            // About 10 ms of input a step, as a device delivers it.
            let chunk = (rate_in as usize / 100).max(1);
            Some(
                Fft::<f32>::new(
                    rate_in as usize,
                    rate_out as usize,
                    chunk,
                    channels,
                    FixedSync::Input,
                )
                .map_err(resample_error)?,
            )
        };
        let (to_trim, scratch) = match &fft {
            Some(fft) => (
                fft.output_delay(),
                vec![0.0; fft.output_frames_max() * channels],
            ),
            None => (0, Vec::new()),
        };
        Ok(Self {
            fft,
            channels,
            rate_in: u64::from(rate_in),
            rate_out: u64::from(rate_out),
            pending: Vec::new(),
            scratch,
            to_trim,
            taken: 0,
            given: 0,
        })
    }

    /// How long the output of `frames` input frames is, in output frames.
    pub fn length_for(&self, frames: u64) -> u64 {
        (frames * self.rate_out).div_ceil(self.rate_in)
    }

    /// Adds whole frames of interleaved input and appends what is ready.
    pub fn push(&mut self, interleaved: &[f32], out: &mut Vec<f32>) -> Result<(), String> {
        self.taken += (interleaved.len() / self.channels) as u64;
        if self.fft.is_none() {
            out.extend_from_slice(interleaved);
            self.given = self.taken;
            return Ok(());
        }
        self.pending.extend_from_slice(interleaved);
        let mut start = 0;
        loop {
            let need = self.fft.as_ref().map_or(0, |fft| fft.input_frames_next());
            if (self.pending.len() - start) / self.channels < need {
                break;
            }
            let end = start + need * self.channels;
            let piece = std::mem::take(&mut self.pending);
            let result = self.step(&piece[start..end], None, out);
            self.pending = piece;
            result?;
            start = end;
        }
        self.pending.drain(..start);
        Ok(())
    }

    /// Ends the stream: what the resampler still holds comes out, and the
    /// output ends where the input does.
    pub fn finish(&mut self, out: &mut Vec<f32>) -> Result<(), String> {
        if self.fft.is_none() {
            return Ok(());
        }
        let total = self.length_for(self.taken);
        let piece = std::mem::take(&mut self.pending);
        let left = piece.len() / self.channels;
        if left > 0 {
            self.step(&piece, Some(left), out)?;
        }
        // Silence pushes out the rest of the delay.
        while self.given < total {
            self.step(&[], Some(0), out)?;
        }
        Ok(())
    }

    /// Runs one step of the resampler and hands out its output, minus what
    /// is left of the delay and never past where the input taken so far
    /// ends. `partial` frames of `input` are real audio; the rest of the step
    /// is silence.
    fn step(
        &mut self,
        input: &[f32],
        partial: Option<usize>,
        out: &mut Vec<f32>,
    ) -> Result<(), String> {
        let Some(fft) = self.fft.as_mut() else {
            return Ok(());
        };
        let channels = self.channels;
        let frames_in = input.len() / channels;
        let adapter_in =
            InterleavedSlice::new(input, channels, frames_in).map_err(resample_error)?;
        let frames_out = fft.output_frames_next();
        let mut adapter_out = InterleavedSlice::new_mut(
            &mut self.scratch[..frames_out * channels],
            channels,
            frames_out,
        )
        .map_err(resample_error)?;
        let indexing = partial.map(|frames| Indexing::new().partial_len(frames));
        let (_, made) = fft
            .process_into_buffer(&adapter_in, &mut adapter_out, indexing.as_ref())
            .map_err(resample_error)?;
        let skip = self.to_trim.min(made);
        self.to_trim -= skip;
        let room = self.length_for(self.taken).saturating_sub(self.given) as usize;
        let give = (made - skip).min(room);
        out.extend_from_slice(&self.scratch[skip * channels..(skip + give) * channels]);
        self.given += give as u64;
        Ok(())
    }
}

/// What a piece of audio becomes.
#[derive(Debug, Default, PartialEq)]
pub struct Converted {
    /// 48 kHz audio of one or two channels, interleaved, for the
    /// high-quality copy. Always empty for a speech-quality recording.
    pub high: Vec<i16>,
    /// 16 kHz mono for the speech engine and the working WAV.
    pub speech: Vec<i16>,
}

/// Mixes interleaved frames of any channel count down to mono, as -1.0..1.0.
fn mono(interleaved: &[i16], channels: usize) -> Vec<f32> {
    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().map(|s| f32::from(*s)).sum::<f32>() / (channels as f32 * 32768.0))
        .collect()
}

/// Mixes interleaved frames of more than two channels down to stereo, as
/// -1.0..1.0. The first two channels are front left and front right in every
/// common layout; every other channel goes to both sides at half level. The
/// sum is scaled so that it never clips.
fn stereo(interleaved: &[i16], channels: usize) -> Vec<f32> {
    let scale = 1.0 / ((1.0 + 0.5 * (channels - 2) as f32) * 32768.0);
    let mut mixed = Vec::with_capacity(interleaved.len() / channels * 2);
    for frame in interleaved.chunks_exact(channels) {
        let shared: f32 = frame[2..].iter().map(|s| f32::from(*s) * 0.5).sum();
        mixed.push((f32::from(frame[0]) + shared) * scale);
        mixed.push((f32::from(frame[1]) + shared) * scale);
    }
    mixed
}

fn as_float(interleaved: &[i16]) -> Vec<f32> {
    interleaved
        .iter()
        .map(|s| f32::from(*s) / 32768.0)
        .collect()
}

/// Back to 16-bit samples. The same scale both ways, so audio that passes
/// through unchanged comes back sample for sample.
fn to_pcm(samples: &[f32], out: &mut Vec<i16>) {
    out.extend(
        samples
            .iter()
            .map(|s| (s * 32768.0).round().clamp(-32768.0, 32767.0) as i16),
    );
}

/// One of the two outputs: a resampler, or nothing to do when the source
/// already has the output's rate and channel layout.
enum Path {
    Same,
    Resample(Box<StreamResampler>),
}

/// Turns a source's audio into the 16 kHz mono the speech engine needs and,
/// for a high-quality recording, a 48 kHz copy of one or two channels.
pub struct Converter {
    format: PcmFormat,
    speech: Path,
    /// The high-quality output and its channel count.
    high: Option<(Path, usize)>,
    /// Input frames taken so far.
    taken: u64,
    scratch: Vec<f32>,
}

impl Converter {
    pub fn new(format: PcmFormat, high_quality: bool) -> Result<Self, String> {
        let format = PcmFormat::new(format.rate, format.channels)?;
        let path = |rate: u32, channels: usize, passes: bool| -> Result<Path, String> {
            Ok(if passes {
                Path::Same
            } else {
                Path::Resample(Box::new(StreamResampler::new(format.rate, rate, channels)?))
            })
        };
        let speech = path(SPEECH_RATE, 1, format == PcmFormat::SPEECH)?;
        let high = if high_quality {
            let channels = usize::from(format.channels.min(2));
            let passes = format.rate == HIGH_RATE && format.channels <= 2;
            Some((path(HIGH_RATE, channels, passes)?, channels))
        } else {
            None
        };
        Ok(Self {
            format,
            speech,
            high,
            taken: 0,
            scratch: Vec::new(),
        })
    }

    pub fn format(&self) -> PcmFormat {
        self.format
    }

    /// Channels of the high-quality copy, when there is one.
    pub fn high_channels(&self) -> Option<u8> {
        self.high.as_ref().map(|(_, channels)| *channels as u8)
    }

    /// Stops making the high-quality copy, which can no longer be kept:
    /// from now on only the speech output comes out.
    pub fn drop_high(&mut self) {
        self.high = None;
    }

    /// 16 kHz samples the input taken so far makes, delivered or not yet.
    pub fn speech_length(&self) -> u64 {
        self.speech_length_for(self.taken)
    }

    fn speech_length_for(&self, frames: u64) -> u64 {
        (frames * u64::from(SPEECH_RATE)).div_ceil(u64::from(self.format.rate))
    }

    /// Converts whole frames of interleaved input.
    pub fn push(&mut self, interleaved: &[i16]) -> Result<Converted, String> {
        let channels = usize::from(self.format.channels);
        if !interleaved.len().is_multiple_of(channels) {
            return Err("Invalid 16-bit PCM audio or frame size.".into());
        }
        self.taken += (interleaved.len() / channels) as u64;
        let mut converted = Converted::default();
        match &mut self.speech {
            Path::Same => converted.speech.extend_from_slice(interleaved),
            Path::Resample(resampler) => {
                self.scratch.clear();
                resampler.push(&mono(interleaved, channels), &mut self.scratch)?;
                to_pcm(&self.scratch, &mut converted.speech);
            }
        }
        if let Some((path, _)) = &mut self.high {
            match path {
                Path::Same => converted.high.extend_from_slice(interleaved),
                Path::Resample(resampler) => {
                    let input = if channels > 2 {
                        stereo(interleaved, channels)
                    } else {
                        as_float(interleaved)
                    };
                    self.scratch.clear();
                    resampler.push(&input, &mut self.scratch)?;
                    to_pcm(&self.scratch, &mut converted.high);
                }
            }
        }
        Ok(converted)
    }

    /// Ends the stream: what the resamplers still hold comes out.
    pub fn finish(&mut self) -> Result<Converted, String> {
        let mut converted = Converted::default();
        if let Path::Resample(resampler) = &mut self.speech {
            self.scratch.clear();
            resampler.finish(&mut self.scratch)?;
            to_pcm(&self.scratch, &mut converted.speech);
        }
        if let Some((Path::Resample(resampler), _)) = &mut self.high {
            self.scratch.clear();
            resampler.finish(&mut self.scratch)?;
            to_pcm(&self.scratch, &mut converted.high);
        }
        Ok(converted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: u32, hz: f64, frames: usize, amplitude: f64) -> Vec<f32> {
        (0..frames)
            .map(|i| {
                ((i as f64 * hz * std::f64::consts::TAU / f64::from(rate)).sin() * amplitude) as f32
            })
            .collect()
    }

    fn pcm_tone(rate: u32, hz: f64, frames: usize) -> Vec<i16> {
        tone(rate, hz, frames, 0.5)
            .iter()
            .map(|s| (s * 32767.0) as i16)
            .collect()
    }

    /// Feeds `input` in pieces of the given sizes, in turn, then finishes.
    fn resample_in_pieces(
        resampler: &mut StreamResampler,
        input: &[f32],
        channels: usize,
        pieces: &[usize],
    ) -> Vec<f32> {
        let mut out = Vec::new();
        let mut at = 0;
        let mut turn = 0;
        while at < input.len() {
            let frames = pieces[turn % pieces.len()];
            let end = (at + frames * channels).min(input.len());
            resampler.push(&input[at..end], &mut out).unwrap();
            at = end;
            turn += 1;
        }
        resampler.finish(&mut out).unwrap();
        out
    }

    /// The amplitude of the component at `hz`, by projection.
    fn level_at(signal: &[f32], rate: u32, hz: f64) -> f64 {
        let (mut s, mut c) = (0f64, 0f64);
        for (i, v) in signal.iter().enumerate() {
            let w = i as f64 / f64::from(rate) * hz * std::f64::consts::TAU;
            s += f64::from(*v) * w.sin();
            c += f64::from(*v) * w.cos();
        }
        2.0 * (s * s + c * c).sqrt() / signal.len() as f64
    }

    fn decibels(ratio: f64) -> f64 {
        20.0 * ratio.log10()
    }

    #[test]
    fn gives_out_exactly_the_length_the_input_calls_for() {
        // 10 ms pieces as a device delivers them, and odd sizes as the
        // webview or a pipe can.
        for (rate_in, rate_out, channels) in [
            (48_000, 16_000, 1),
            (44_100, 48_000, 2),
            (44_100, 16_000, 1),
            (22_050, 48_000, 1),
            (96_000, 48_000, 2),
            (16_000, 48_000, 1),
        ] {
            for pieces in [vec![rate_in as usize / 100], vec![1, 7, 333, 1024, 4095]] {
                for seconds in [0.013, 1.0, 2.5] {
                    let frames = (f64::from(rate_in) * seconds) as usize;
                    let input = vec![0.1f32; frames * channels];
                    let mut resampler = StreamResampler::new(rate_in, rate_out, channels).unwrap();
                    let out = resample_in_pieces(&mut resampler, &input, channels, &pieces);
                    let expected =
                        (frames as u64 * u64::from(rate_out)).div_ceil(u64::from(rate_in));
                    assert_eq!(
                        out.len() as u64,
                        expected * channels as u64,
                        "{rate_in} -> {rate_out}, {channels} ch, {seconds} s, pieces {pieces:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn the_resampler_delay_is_cut_so_an_impulse_stays_in_place() {
        for (rate_in, rate_out) in [(48_000, 16_000), (44_100, 48_000), (16_000, 48_000)] {
            let frames = rate_in as usize;
            let at = rate_in as usize / 4;
            let mut input = vec![0f32; frames];
            input[at] = 1.0;
            let mut resampler = StreamResampler::new(rate_in, rate_out, 1).unwrap();
            let out = resample_in_pieces(&mut resampler, &input, 1, &[rate_in as usize / 100]);
            let peak = out
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
                .unwrap()
                .0;
            let expected = at as f64 * f64::from(rate_out) / f64::from(rate_in);
            assert!(
                (peak as f64 - expected).abs() <= 1.0,
                "{rate_in} -> {rate_out}: impulse at {peak}, expected {expected}"
            );
        }
    }

    #[test]
    fn keeps_speech_and_keeps_what_is_above_it_out_of_the_speech_rate() {
        let rate = 48_000;
        let frames = 2 * rate as usize;
        let measure = |hz: f64| {
            let mut resampler = StreamResampler::new(rate, SPEECH_RATE, 1).unwrap();
            let out = resample_in_pieces(&mut resampler, &tone(rate, hz, frames, 0.5), 1, &[480]);
            // Away from the edges.
            level_at(
                &out[4000..out.len() - 4000],
                SPEECH_RATE,
                if hz > 8000.0 { 16_000.0 - hz } else { hz },
            )
        };
        // A 1 kHz tone keeps its level within half a decibel.
        let kept = decibels(measure(1000.0) / 0.5);
        assert!(kept.abs() < 0.5, "1 kHz changed by {kept:.2} dB");
        // Tones above 8 kHz would fold back into the speech band: they stay
        // far below hearing next to speech.
        for hz in [10_000.0, 12_000.0, 15_000.0] {
            let folded = decibels(measure(hz) / 0.5);
            assert!(folded < -60.0, "{hz} Hz folded back at {folded:.1} dB");
        }
    }

    #[test]
    fn brings_44_1_khz_stereo_to_48_khz_with_its_channels_apart() {
        let rate = 44_100;
        let frames = 2 * rate as usize;
        let left = tone(rate, 1000.0, frames, 0.5);
        let right = tone(rate, 3000.0, frames, 0.25);
        let input: Vec<f32> = left
            .iter()
            .zip(&right)
            .flat_map(|(l, r)| [*l, *r])
            .collect();
        let mut resampler = StreamResampler::new(rate, HIGH_RATE, 2).unwrap();
        let out = resample_in_pieces(&mut resampler, &input, 2, &[441]);
        assert_eq!(out.len(), 2 * 2 * HIGH_RATE as usize);
        let channel = |which: usize| -> Vec<f32> {
            out.iter()
                .skip(which)
                .step_by(2)
                .copied()
                .collect::<Vec<_>>()[4800..91_200]
                .to_vec()
        };
        let (out_left, out_right) = (channel(0), channel(1));
        assert!((level_at(&out_left, HIGH_RATE, 1000.0) - 0.5).abs() < 0.01);
        assert!((level_at(&out_right, HIGH_RATE, 3000.0) - 0.25).abs() < 0.01);
        assert!(level_at(&out_left, HIGH_RATE, 3000.0) < 0.001);
        assert!(level_at(&out_right, HIGH_RATE, 1000.0) < 0.001);
    }

    #[test]
    fn refuses_rates_and_channels_out_of_range() {
        assert!(StreamResampler::new(7_999, 16_000, 1).is_err());
        assert!(StreamResampler::new(48_000, 16_000, 0).is_err());
        assert!(PcmFormat::new(48_000, 0).is_err());
        assert!(PcmFormat::new(48_000, MAX_CHANNELS + 1).is_err());
        assert!(PcmFormat::new(MAX_RATE + 1, 2).is_err());
        assert_eq!(PcmFormat::new(16_000, 1).unwrap(), PcmFormat::SPEECH);
    }

    #[test]
    fn speech_at_16_khz_mono_passes_through_sample_for_sample() {
        let input = vec![i16::MIN, -1, 0, 1, 12_345, i16::MAX];
        let mut converter = Converter::new(PcmFormat::SPEECH, false).unwrap();
        let converted = converter.push(&input).unwrap();
        assert_eq!(converted.speech, input);
        assert!(converted.high.is_empty());
        assert_eq!(converter.finish().unwrap(), Converted::default());
        assert_eq!(converter.high_channels(), None);
        assert_eq!(converter.speech_length(), 6);

        // A high-quality 16 kHz mono source: the speech path is still exact.
        let mut converter = Converter::new(PcmFormat::SPEECH, true).unwrap();
        let mut converted = converter.push(&input).unwrap();
        assert_eq!(converted.speech, input);
        let rest = converter.finish().unwrap();
        converted.high.extend(rest.high);
        assert_eq!(converted.high.len(), 18);
        assert_eq!(converter.high_channels(), Some(1));
    }

    #[test]
    fn high_quality_48_khz_stereo_is_kept_as_it_is_and_mixed_for_speech() {
        let format = PcmFormat::new(48_000, 2).unwrap();
        let mut converter = Converter::new(format, true).unwrap();
        assert_eq!(converter.high_channels(), Some(2));
        // Left and right cancel out in the mono mix.
        let frames = 48_000;
        let left = pcm_tone(48_000, 440.0, frames);
        let input: Vec<i16> = left.iter().flat_map(|s| [*s, -*s]).collect();
        let mut converted = Converted::default();
        for piece in input.chunks(2 * 1024) {
            let out = converter.push(piece).unwrap();
            converted.high.extend(out.high);
            converted.speech.extend(out.speech);
        }
        let rest = converter.finish().unwrap();
        converted.speech.extend(rest.speech);
        assert!(rest.high.is_empty());
        assert_eq!(converted.high, input);
        assert_eq!(converted.speech.len(), 16_000);
        assert!(converted.speech.iter().all(|s| s.unsigned_abs() <= 1));
        assert_eq!(converter.speech_length(), 16_000);
    }

    #[test]
    fn more_than_two_channels_are_mixed_to_stereo_and_to_mono() {
        // 5.1 at 48 kHz: front left, front right, centre, LFE, back left,
        // back right. Everything at full scale must not clip.
        let format = PcmFormat::new(48_000, 6).unwrap();
        let mut converter = Converter::new(format, true).unwrap();
        assert_eq!(converter.high_channels(), Some(2));
        let frames = 4800;
        let mut input = Vec::with_capacity(frames * 6);
        for _ in 0..frames {
            input.extend_from_slice(&[16_000, -16_000, 8_000, 0, 0, 0]);
        }
        let mut converted = converter.push(&input).unwrap();
        let rest = converter.finish().unwrap();
        converted.high.extend(rest.high);
        converted.speech.extend(rest.speech);
        assert_eq!(converted.high.len(), frames * 2);
        assert_eq!(converted.speech.len(), frames / 3);
        // Left: (16000 + 0.5 * 8000) / 3, right: (-16000 + 0.5 * 8000) / 3.
        let middle = (converted.high.len() / 2) & !1;
        assert!((i32::from(converted.high[middle]) - 6_667).abs() <= 2);
        assert!((i32::from(converted.high[middle + 1]) + 4_000).abs() <= 2);
        // Mono: the average of all six, 8000 / 6.
        let speech = converted.speech[converted.speech.len() / 2];
        assert!((i32::from(speech) - 1_333).abs() <= 2, "{speech}");

        let loud = vec![i16::MAX; 6 * 480];
        let mut converter = Converter::new(format, true).unwrap();
        let out = converter.push(&loud).unwrap();
        assert!(out.high.iter().all(|s| *s > 30_000));
    }

    #[test]
    fn a_piece_must_hold_whole_frames() {
        let mut converter = Converter::new(PcmFormat::new(44_100, 2).unwrap(), true).unwrap();
        assert!(converter.push(&[1, 2, 3]).is_err());
        assert!(converter.push(&[1, 2]).is_ok());
        assert!(Converter::new(
            PcmFormat {
                rate: 4_000,
                channels: 1
            },
            false
        )
        .is_err());
    }

    #[test]
    fn a_44_1_khz_stereo_device_gives_48_khz_and_16_khz_of_the_right_length() {
        let format = PcmFormat::new(44_100, 2).unwrap();
        let mut converter = Converter::new(format, true).unwrap();
        let frames = 3 * 44_100 + 17;
        let left = pcm_tone(44_100, 1000.0, frames);
        let input: Vec<i16> = left.iter().flat_map(|s| [*s, *s]).collect();
        let (mut high, mut speech) = (0, 0);
        for piece in input.chunks(2 * 441) {
            let out = converter.push(piece).unwrap();
            high += out.high.len();
            speech += out.speech.len();
        }
        assert_eq!(
            converter.speech_length(),
            (frames as u64 * 16_000).div_ceil(44_100)
        );
        let rest = converter.finish().unwrap();
        high += rest.high.len();
        speech += rest.speech.len();
        assert_eq!(high as u64, 2 * (frames as u64 * 48_000).div_ceil(44_100));
        assert_eq!(speech as u64, (frames as u64 * 16_000).div_ceil(44_100));
    }
}
