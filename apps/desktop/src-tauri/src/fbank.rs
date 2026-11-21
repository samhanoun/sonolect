//! Log mel filterbank features, computed the way Kaldi (and kaldi-native-fbank,
//! which the speaker model was trained with) computes them: 25 ms frames every
//! 10 ms, no dither, frames centred on the audio with its edges reflected
//! (`snip_edges = false`), DC removed, pre-emphasis 0.97, Povey window,
//! 512-point FFT, power spectrum, 80 triangular mel bins from 20 Hz to
//! 7600 Hz, natural log.
use realfft::{num_complex::Complex, RealFftPlanner, RealToComplex};
use std::sync::Arc;

const RATE: f32 = 16_000.0;
/// 25 ms of audio.
const LENGTH: usize = 400;
/// 10 ms of audio.
pub const SHIFT: usize = 160;
const FFT: usize = 512;
/// Mel bins per frame.
pub const BINS: usize = 80;
const PREEMPHASIS: f32 = 0.97;
const LOW_HZ: f32 = 20.0;
/// Nyquist minus 400 Hz, as Kaldi's `high_freq = -400` means.
const HIGH_HZ: f32 = RATE / 2.0 - 400.0;

fn mel(hz: f32) -> f32 {
    1127.0 * (1.0 + hz / 700.0).ln()
}

pub struct Fbank {
    window: Vec<f32>,
    /// For each bin: its first FFT bin and the weights from there on.
    banks: Vec<(usize, Vec<f32>)>,
    fft: Arc<dyn RealToComplex<f32>>,
    input: Vec<f32>,
    spectrum: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    power: Vec<f32>,
}

impl Fbank {
    pub fn new() -> Self {
        let window = (0..LENGTH)
            .map(|i| {
                let hann =
                    0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / (LENGTH - 1) as f32).cos();
                hann.powf(0.85)
            })
            .collect();
        let (low, high) = (mel(LOW_HZ), mel(HIGH_HZ));
        let delta = (high - low) / (BINS + 1) as f32;
        let banks = (0..BINS)
            .map(|bin| {
                let left = low + bin as f32 * delta;
                let centre = left + delta;
                let right = centre + delta;
                let mut first = None;
                let mut weights = vec![];
                for index in 0..FFT / 2 {
                    let m = mel(RATE / FFT as f32 * index as f32);
                    if m > left && m < right {
                        first.get_or_insert(index);
                        weights.push(if m <= centre {
                            (m - left) / (centre - left)
                        } else {
                            (right - m) / (right - centre)
                        });
                    } else if first.is_some() {
                        break;
                    }
                }
                (first.unwrap_or(0), weights)
            })
            .collect();
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(FFT);
        Self {
            window,
            banks,
            input: fft.make_input_vec(),
            spectrum: fft.make_output_vec(),
            scratch: fft.make_scratch_vec(),
            power: vec![0.0; FFT / 2 + 1],
            fft,
        }
    }

    /// The number of frames `samples` samples give: one every 10 ms, counted
    /// from the middle of each shift.
    pub fn frames(samples: usize) -> usize {
        (samples + SHIFT / 2) / SHIFT
    }

    /// The features of `samples` (16 kHz, scaled to -1..1), one row of 80
    /// values per 10 ms.
    pub fn compute(&mut self, samples: &[f32]) -> Vec<[f32; BINS]> {
        let length = samples.len() as isize;
        let mut rows = Vec::with_capacity(Self::frames(samples.len()));
        if length == 0 {
            return rows;
        }
        for frame_index in 0..Self::frames(samples.len()) {
            // Centred on the middle of its 10 ms; outside the audio, the
            // audio is reflected back in.
            let start = (frame_index * SHIFT + SHIFT / 2) as isize - (LENGTH / 2) as isize;
            let mut frame = [0f32; LENGTH];
            for (offset, value) in frame.iter_mut().enumerate() {
                let mut at = start + offset as isize;
                while at < 0 || at >= length {
                    at = if at < 0 { -at - 1 } else { 2 * length - 1 - at };
                }
                *value = samples[at as usize];
            }
            let mean = frame.iter().sum::<f32>() / LENGTH as f32;
            frame.iter_mut().for_each(|value| *value -= mean);
            for index in (1..LENGTH).rev() {
                frame[index] -= PREEMPHASIS * frame[index - 1];
            }
            frame[0] -= PREEMPHASIS * frame[0];
            self.input.fill(0.0);
            for (input, (value, weight)) in
                self.input.iter_mut().zip(frame.iter().zip(&self.window))
            {
                *input = value * weight;
            }
            self.fft
                .process_with_scratch(&mut self.input, &mut self.spectrum, &mut self.scratch)
                .expect("buffers are sized by the plan");
            for (power, bin) in self.power.iter_mut().zip(&self.spectrum) {
                *power = bin.norm_sqr();
            }
            let mut row = [0f32; BINS];
            for (value, (first, weights)) in row.iter_mut().zip(&self.banks) {
                let energy: f32 = weights
                    .iter()
                    .zip(&self.power[*first..])
                    .map(|(weight, power)| weight * power)
                    .sum();
                *value = energy.max(f32::EPSILON).ln();
            }
            rows.push(row);
        }
        rows
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One second of a deterministic signal: two tones, a chirp and a little
    /// noise, rounded to 16-bit samples like a recording. The same formula is
    /// in `fixtures/make-speaker-fixtures.py`.
    pub fn reference_signal() -> Vec<f32> {
        let mut state: u32 = 12_345;
        (0..16_000)
            .map(|i| {
                let t = i as f64 / 16_000.0;
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let noise = f64::from(state >> 8) / f64::from(1u32 << 24) * 2.0 - 1.0;
                let value = 0.3 * (std::f64::consts::TAU * 220.0 * t).sin()
                    + 0.2 * (std::f64::consts::TAU * 1375.0 * t + 0.5).sin()
                    + 0.1 * (std::f64::consts::TAU * (300.0 * t + 1500.0 * t * t)).sin()
                    + 0.02 * noise;
                ((value * 32767.0).round() as i16) as f32 / 32768.0
            })
            .collect()
    }

    #[test]
    fn matches_kaldi_native_fbank() {
        let expected: Vec<f32> = include_bytes!("../fixtures/fbank-reference.f32")
            .as_chunks::<4>()
            .0
            .iter()
            .map(|bytes| f32::from_le_bytes(*bytes))
            .collect();
        let rows = Fbank::new().compute(&reference_signal());
        assert_eq!(rows.len(), 100);
        assert_eq!(expected.len(), 100 * BINS);
        let worst = rows
            .iter()
            .flatten()
            .zip(&expected)
            .map(|(value, expected)| (value - expected).abs())
            .fold(0f32, f32::max);
        assert!(worst < 1e-3, "largest difference {worst}");
    }

    #[test]
    fn gives_a_row_every_ten_milliseconds() {
        assert_eq!(Fbank::frames(24_000), 150);
        assert_eq!(Fbank::frames(16_000), 100);
        assert_eq!(Fbank::frames(79), 0);
        assert_eq!(Fbank::frames(80), 1);
        let mut fbank = Fbank::new();
        assert!(fbank.compute(&[]).is_empty());
        // A very short piece is reflected into a whole frame.
        let rows = fbank.compute(&[0.1; 100]);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].iter().all(|value| value.is_finite()));
    }
}
