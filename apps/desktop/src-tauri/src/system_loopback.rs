//! What is playing on Windows, as a source of audio for a recording.
//!
//! WASAPI records a playback device when it is opened for capture
//! ("loopback"): no driver, no virtual cable and no permission prompt. The
//! device's own format is kept and converted here, because a loopback stream
//! cannot ask Windows for another one.
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

use super::audio_feed::{Feed, Source, ToSpeech};

/// How long `next` waits for audio before it reports a quiet moment.
const WAIT: Duration = Duration::from_millis(200);

/// Whether there is a playback device to record.
pub fn available() -> bool {
    cpal::default_host().default_output_device().is_some()
}

pub struct Loopback {
    stream: Stream,
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
    let format = device
        .default_output_config()
        .map_err(|error| format!("Cannot read the playback format: {error}"))?;
    let convert = ToSpeech::new(format.sample_rate(), format.channels())?;
    let (sender, audio) = mpsc::channel();
    let failed = Arc::new(Mutex::new(None));
    let config = format.config();
    let stream = match format.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, config, convert, sender, &failed),
        SampleFormat::I16 => build::<i16>(&device, config, convert, sender, &failed),
        SampleFormat::U16 => build::<u16>(&device, config, convert, sender, &failed),
        SampleFormat::I32 => build::<i32>(&device, config, convert, sender, &failed),
        other => Err(format!("Unsupported playback format: {other}.")),
    }?;
    stream
        .play()
        .map_err(|error| format!("Cannot start recording system audio: {error}"))?;
    Ok(Loopback {
        stream,
        audio,
        failed,
        closing,
        done: false,
    })
}

fn build<T>(
    device: &Device,
    config: StreamConfig,
    mut convert: ToSpeech,
    sender: Sender<Vec<i16>>,
    failed: &Arc<Mutex<Option<String>>>,
) -> Result<Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let failed = Arc::clone(failed);
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &InputCallbackInfo| {
                let mut block = Vec::with_capacity(convert.capacity(data.len()));
                convert.push(
                    data.iter().map(|sample| f32::from_sample(*sample)),
                    &mut block,
                );
                if !block.is_empty() {
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
