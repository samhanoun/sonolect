//! What is playing on Windows, as a source of audio for a recording.
//!
//! WASAPI records a playback device when it is opened for capture
//! ("loopback"): no driver, no virtual cable and no permission prompt. A
//! loopback stream cannot ask Windows for another format, so the device's own
//! rate and channels are kept: this file only turns its samples into 16-bit
//! ones. The recording converts the rest (`resample::Converter`), on every
//! platform alike, where it is tested.
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Arc, Mutex,
    },
    time::Duration,
};

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    Device, ErrorKind, FromSample, InputCallbackInfo, Sample, SampleFormat, SizedSample, Stream,
    StreamConfig,
};

use super::{
    audio_feed::{Feed, Source},
    resample::PcmFormat,
};

/// How long `next` waits for audio before it reports a quiet moment.
const WAIT: Duration = Duration::from_millis(200);

/// Whether there is a playback device to record.
pub fn available() -> bool {
    cpal::default_host().default_output_device().is_some()
}

pub struct Loopback {
    stream: Stream,
    format: PcmFormat,
    audio: Receiver<Vec<i16>>,
    failed: Arc<Mutex<Option<String>>>,
    closing: Arc<AtomicBool>,
    done: bool,
}

/// Starts recording the default playback device. The recording ends when
/// `closing` is set: `next` then hands over what is still waiting, and ends.
pub fn open(closing: Arc<AtomicBool>) -> Result<Loopback, String> {
    let device = cpal::default_host()
        .default_output_device()
        .ok_or("There is no playback device to record.")?;
    let output = device
        .default_output_config()
        .map_err(|error| format!("Cannot read the playback format: {error}"))?;
    if output.sample_rate() == 0 || output.channels() == 0 {
        return Err("The playback device reports no audio format.".into());
    }
    let format = PcmFormat::new(output.sample_rate(), output.channels()).map_err(|_| {
        format!(
            "Unsupported playback format: {} Hz, {} channels.",
            output.sample_rate(),
            output.channels()
        )
    })?;
    let (sender, audio) = mpsc::channel();
    let failed = Arc::new(Mutex::new(None));
    let config = output.config();
    let stream = match output.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, config, sender, &failed),
        SampleFormat::I16 => build::<i16>(&device, config, sender, &failed),
        SampleFormat::U16 => build::<u16>(&device, config, sender, &failed),
        SampleFormat::I32 => build::<i32>(&device, config, sender, &failed),
        other => Err(format!("Unsupported playback format: {other}.")),
    }?;
    stream
        .play()
        .map_err(|error| format!("Cannot start recording system audio: {error}"))?;
    Ok(Loopback {
        stream,
        format,
        audio,
        failed,
        closing,
        done: false,
    })
}

/// Records the device in its own format and hands over its samples as
/// 16-bit ones, interleaved as they came.
fn build<T>(
    device: &Device,
    config: StreamConfig,
    sender: Sender<Vec<i16>>,
    failed: &Arc<Mutex<Option<String>>>,
) -> Result<Stream, String>
where
    T: SizedSample,
    i16: FromSample<T>,
{
    let failed = Arc::clone(failed);
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &InputCallbackInfo| {
                if !data.is_empty() {
                    let block: Vec<i16> = data.iter().map(|s| i16::from_sample(*s)).collect();
                    // The receiver is gone once the recording has ended.
                    let _ = sender.send(block);
                }
            },
            move |error| match error.kind() {
                // The stream carries on after these.
                ErrorKind::Xrun | ErrorKind::DeviceChanged | ErrorKind::RealtimeDenied => {}
                _ => {
                    if let Ok(mut failed) = failed.lock() {
                        failed.get_or_insert_with(|| format!("System audio stopped: {error}"));
                    }
                }
            },
            None,
        )
        .map_err(|error| format!("Cannot record system audio: {error}"))
}

impl Loopback {
    fn waiting(&self, mut block: Vec<i16>) -> Vec<i16> {
        for more in self.audio.try_iter() {
            block.extend(more);
        }
        block
    }
}

impl Source for Loopback {
    fn format(&self) -> PcmFormat {
        self.format
    }

    fn next(&mut self) -> Feed {
        if self.done {
            return Feed::Ended(None);
        }
        if let Some(message) = self.failed.lock().ok().and_then(|mut failed| failed.take()) {
            self.done = true;
            return Feed::Ended(Some(message));
        }
        if self.closing.load(Ordering::Relaxed) {
            self.done = true;
            let _ = self.stream.pause();
            let rest = self.waiting(Vec::new());
            return if rest.is_empty() {
                Feed::Ended(None)
            } else {
                Feed::Audio(rest)
            };
        }
        match self.audio.recv_timeout(WAIT) {
            Ok(block) => Feed::Audio(self.waiting(block)),
            Err(RecvTimeoutError::Timeout) => Feed::Quiet,
            Err(RecvTimeoutError::Disconnected) => {
                self.done = true;
                Feed::Ended(Some("System audio stopped.".into()))
            }
        }
    }
}
