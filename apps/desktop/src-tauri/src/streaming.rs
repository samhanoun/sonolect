//! Live recordings of any length.
//!
//! The web layer sends PCM in small pieces while it records: 16 kHz mono,
//! or, for a high-quality recording, the rate and channels of its source.
//! Each piece is written straight away to the recording's 16 kHz mono WAV
//! file, the working copy that the speech engine reads, so nothing is lost
//! if the app stops, and the audio is transcribed chunk by chunk at natural
//! pauses. A high-quality recording also writes a 48 kHz Opus copy as it
//! goes, which replaces the WAV once the recording is finished. Every
//! finished chunk is announced with a `capture-partial` event, which is how
//! text appears while the user is still speaking.
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;

use super::{
    compact_audio, local_history,
    resample::{Converter, PcmFormat, HIGH_RATE},
    WhisperResult, WhisperSegment,
};

pub const SAMPLE_RATE: u64 = 16_000;
/// Four hours, the longest session the product promises.
pub const MAX_SAMPLES: u64 = 4 * 3600 * SAMPLE_RATE;
/// Loudness is measured in 20 ms frames.
const FRAME: usize = 320;
/// A chunk is never cut shorter than this, so the engine has context.
const MIN_CHUNK: usize = 3 * SAMPLE_RATE as usize;
/// Without any pause, a chunk is cut here (under Whisper's 30 s window).
const MAX_CHUNK: usize = 25 * SAMPLE_RATE as usize;
/// A pause is 300 ms of quiet.
const PAUSE_FRAMES: usize = 15;
/// Frames under this level (about -50 dBFS) count as silence.
const SILENCE_RMS: f32 = 100.0;
/// The WAV header is brought up to date this often while recording.
const HEADER_SYNC_SAMPLES: u64 = 5 * SAMPLE_RATE;

/// A stretch of the recording, ready to be transcribed on its own.
#[derive(Debug, PartialEq)]
pub struct Chunk {
    pub start_sample: u64,
    pub samples: Vec<i16>,
    /// Nothing but silence: not worth sending to the engine, which tends to
    /// invent words for silent audio.
    pub silent: bool,
}

/// The loudness of each whole 20 ms frame of `samples`, as an RMS of the
/// 16-bit values. A partial frame at the end is left out.
pub(crate) fn frame_levels(samples: &[i16]) -> Vec<f32> {
    samples
        .as_chunks::<FRAME>()
        .0
        .iter()
        .map(|frame| {
            let energy: f64 = frame.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
            (energy / FRAME as f64).sqrt() as f32
        })
        .collect()
}

/// Frames under this level count as a pause. Quiet is relative to the
/// loudest speech around it, so a noisy room still has pauses.
pub(crate) fn quiet_level(loudest: f32) -> f32 {
    (loudest * 0.08).max(SILENCE_RMS * 2.0)
}

/// Cuts a stream of samples into chunks at pauses in the speech.
#[derive(Default)]
pub struct Chunker {
    pending: Vec<i16>,
    start: u64,
}

impl Chunker {
    /// Adds audio and returns the chunks that are now complete.
    pub fn push(&mut self, samples: &[i16]) -> Vec<Chunk> {
        self.pending.extend_from_slice(samples);
        let mut chunks = vec![];
        while let Some(cut) = self.cut_point() {
            chunks.push(self.take(cut));
        }
        chunks
    }

    /// The audio left after the last cut, when the recording ends.
    pub fn finish(&mut self) -> Option<Chunk> {
        (!self.pending.is_empty()).then(|| self.take(self.pending.len()))
    }

    fn take(&mut self, cut: usize) -> Chunk {
        let samples: Vec<i16> = self.pending.drain(..cut).collect();
        let chunk = Chunk {
            start_sample: self.start,
            silent: frame_levels(&samples)
                .iter()
                .all(|level| *level < SILENCE_RMS),
            samples,
        };
        self.start += cut as u64;
        chunk
    }

    fn cut_point(&self) -> Option<usize> {
        if self.pending.len() < MIN_CHUNK {
            return None;
        }
        let levels = frame_levels(&self.pending);
        let loudest = levels.iter().copied().fold(0.0, f32::max);
        if loudest < SILENCE_RMS {
            // Only silence so far: hand it over so a long pause never piles up.
            return Some(levels.len() * FRAME);
        }
        let quiet = quiet_level(loudest);
        let earliest = MIN_CHUNK / FRAME;
        let mut run = 0;
        for (index, level) in levels.iter().enumerate() {
            run = if *level < quiet { run + 1 } else { 0 };
            if run >= PAUSE_FRAMES {
                let middle = index + 1 - PAUSE_FRAMES / 2;
                if middle >= earliest {
                    return Some(middle * FRAME);
                }
            }
        }
        if self.pending.len() < MAX_CHUNK {
            return None;
        }
        // Nobody paused: cut at the quietest moment of the last five seconds.
        let from = levels.len().saturating_sub(250);
        (from..levels.len())
            .min_by(|a, b| levels[*a].total_cmp(&levels[*b]))
            .map(|frame| frame.max(1) * FRAME)
    }
}

/// A 16 kHz mono 16-bit WAV file of the given samples.
pub fn wav_bytes(samples: &[i16]) -> Vec<u8> {
    let mut bytes = wav_header(samples.len() as u64).to_vec();
    bytes.extend(samples.iter().flat_map(|sample| sample.to_le_bytes()));
    bytes
}

pub fn wav_header(samples: u64) -> [u8; 44] {
    let data = (samples * 2).min(u64::from(u32::MAX - 36)) as u32;
    let mut header = [0u8; 44];
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&(36 + data).to_le_bytes());
    header[8..16].copy_from_slice(b"WAVEfmt ");
    header[16..20].copy_from_slice(&16u32.to_le_bytes());
    header[20..22].copy_from_slice(&1u16.to_le_bytes());
    header[22..24].copy_from_slice(&1u16.to_le_bytes());
    header[24..28].copy_from_slice(&(SAMPLE_RATE as u32).to_le_bytes());
    header[28..32].copy_from_slice(&(SAMPLE_RATE as u32 * 2).to_le_bytes());
    header[32..34].copy_from_slice(&2u16.to_le_bytes());
    header[34..36].copy_from_slice(&16u16.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data.to_le_bytes());
    header
}

/// Transcribes one chunk of samples.
pub type Transcriber = Box<dyn FnMut(&[i16]) -> Result<WhisperResult, String> + Send>;
/// Told about the segments of each chunk as soon as it is transcribed.
pub type PartialSink = Box<dyn Fn(&[WhisperSegment]) + Send>;

/// Everything heard so far, with timings on the recording's own clock.
struct Transcript {
    transcribe: Transcriber,
    on_partial: PartialSink,
    segments: Vec<WhisperSegment>,
    language: Option<String>,
    error: Option<String>,
}

impl Transcript {
    fn new(transcribe: Transcriber, on_partial: PartialSink) -> Self {
        Self {
            transcribe,
            on_partial,
            segments: vec![],
            language: None,
            error: None,
        }
    }

    fn add(&mut self, chunk: &Chunk) {
        // After a failure the audio is still saved; the user retries later.
        if chunk.silent || self.error.is_some() {
            return;
        }
        let offset_ms = chunk.start_sample * 1000 / SAMPLE_RATE;
        let length_ms = chunk.samples.len() as u64 * 1000 / SAMPLE_RATE;
        match (self.transcribe)(&chunk.samples) {
            Ok(result) => {
                self.language = self.language.take().or(result.language);
                let mut found = result.segments;
                let text = result.text.trim();
                if found.is_empty() && !text.is_empty() {
                    // Online models return text without timings.
                    found.push(WhisperSegment {
                        start_ms: 0,
                        end_ms: length_ms,
                        text: text.to_owned(),
                        ..Default::default()
                    });
                }
                for segment in &mut found {
                    segment.start_ms = segment.start_ms.min(length_ms) + offset_ms;
                    segment.end_ms = segment.end_ms.min(length_ms) + offset_ms;
                }
                if !found.is_empty() {
                    (self.on_partial)(&found);
                    self.segments.extend(found);
                }
            }
            Err(error) => self.error = Some(error),
        }
    }

    fn fail(&mut self, error: String) {
        self.error.get_or_insert(error);
    }

    fn into_outcome(self, samples: u64) -> Outcome {
        Outcome {
            text: self
                .segments
                .iter()
                .map(|segment| segment.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
            segments: self.segments,
            language: self.language,
            error: self.error,
            duration_ms: samples * 1000 / SAMPLE_RATE,
        }
    }
}

/// What a finished recording produced.
#[derive(Debug)]
pub struct Outcome {
    pub text: String,
    pub segments: Vec<WhisperSegment>,
    pub language: Option<String>,
    /// The first transcription failure. The audio is on disk either way.
    pub error: Option<String>,
    pub duration_ms: u64,
}

/// A chunk that waits in the recording's file. The worker reads its samples
/// when it gets to it, so a slow engine never piles audio up in memory.
struct Job {
    start_sample: u64,
    samples: usize,
}

fn read_chunk(file: &mut File, job: &Job) -> std::io::Result<Chunk> {
    file.seek(SeekFrom::Start(44 + job.start_sample * 2))?;
    let mut bytes = vec![0u8; job.samples * 2];
    file.read_exact(&mut bytes)?;
    Ok(Chunk {
        start_sample: job.start_sample,
        samples: bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| i16::from_le_bytes(*pair))
            .collect(),
        silent: false,
    })
}

/// One recording in progress: writes the WAV file as audio arrives and
/// transcribes on a worker thread, so appending audio never waits for the
/// engine.
pub struct Recorder {
    file: File,
    samples: u64,
    synced: u64,
    chunker: Chunker,
    jobs: Option<mpsc::Sender<Job>>,
    worker: Option<thread::JoinHandle<Transcript>>,
    abandoned: Arc<AtomicBool>,
}

impl Recorder {
    pub fn begin(
        wav_path: &Path,
        transcribe: Transcriber,
        on_partial: PartialSink,
    ) -> Result<Self, String> {
        let mut file = File::create(wav_path).map_err(|e| format!("Cannot save recording: {e}"))?;
        file.write_all(&wav_header(0))
            .map_err(|e| format!("Cannot save recording: {e}"))?;
        let mut saved = File::open(wav_path).map_err(|e| format!("Cannot save recording: {e}"))?;
        let (jobs, queue) = mpsc::channel::<Job>();
        let abandoned = Arc::new(AtomicBool::new(false));
        let cancelled = Arc::clone(&abandoned);
        let worker = thread::spawn(move || {
            let mut transcript = Transcript::new(transcribe, on_partial);
            for job in queue {
                if cancelled.load(Ordering::SeqCst) {
                    break;
                }
                match read_chunk(&mut saved, &job) {
                    Ok(chunk) => transcript.add(&chunk),
                    Err(error) => transcript.fail(format!("Cannot read recording: {error}")),
                }
            }
            transcript
        });
        Ok(Self {
            file,
            samples: 0,
            synced: 0,
            chunker: Chunker::default(),
            jobs: Some(jobs),
            worker: Some(worker),
            abandoned,
        })
    }

    /// Adds little-endian 16-bit samples, as the web layer sends them.
    /// Returns the length recorded so far in milliseconds.
    #[cfg(test)]
    pub fn append(&mut self, pcm: &[u8]) -> Result<u64, String> {
        if pcm.len() & 1 == 1 {
            return Err(INVALID_MONO_PCM.into());
        }
        self.append_samples(&samples_of(pcm))
    }

    /// Adds 16 kHz mono samples. Returns the length recorded so far in
    /// milliseconds.
    pub fn append_samples(&mut self, samples: &[i16]) -> Result<u64, String> {
        if samples.is_empty() {
            return Err(INVALID_MONO_PCM.into());
        }
        if self.samples >= MAX_SAMPLES {
            return Err(FOUR_HOURS.into());
        }
        self.write(samples)?;
        Ok(self.recorded_ms())
    }

    /// Adds the last samples of a recording, which the four-hour limit has
    /// already let in: the end of audio a converter was still holding.
    fn append_last(&mut self, samples: &[i16]) -> Result<(), String> {
        if samples.is_empty() {
            return Ok(());
        }
        self.write(samples)
    }

    fn write(&mut self, samples: &[i16]) -> Result<(), String> {
        let pcm: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        self.file
            .write_all(&pcm)
            .map_err(|e| format!("Cannot save recording: {e}"))?;
        self.samples += samples.len() as u64;
        if self.samples - self.synced >= HEADER_SYNC_SAMPLES {
            self.sync_header()?;
        }
        for chunk in self.chunker.push(samples) {
            self.send(chunk);
        }
        Ok(())
    }

    /// The length recorded so far, in milliseconds.
    pub fn recorded_ms(&self) -> u64 {
        self.samples * 1000 / SAMPLE_RATE
    }

    fn send(&self, chunk: Chunk) {
        // Silence is not worth the engine's time, and its samples are
        // already in the file: only the position travels.
        if chunk.silent {
            return;
        }
        if let Some(jobs) = &self.jobs {
            // The worker only goes away once the recording is abandoned.
            let _ = jobs.send(Job {
                start_sample: chunk.start_sample,
                samples: chunk.samples.len(),
            });
        }
    }

    /// Keeps the file a valid WAV at any moment, so an interrupted recording
    /// can still be played and transcribed again.
    fn sync_header(&mut self) -> Result<(), String> {
        let write = |file: &mut File, samples: u64| -> std::io::Result<()> {
            file.seek(SeekFrom::Start(0))?;
            file.write_all(&wav_header(samples))?;
            file.seek(SeekFrom::End(0))?;
            Ok(())
        };
        write(&mut self.file, self.samples).map_err(|e| format!("Cannot save recording: {e}"))?;
        self.synced = self.samples;
        Ok(())
    }

    /// Transcribes what is left and waits for the worker to catch up.
    pub fn finish(mut self) -> Result<Outcome, String> {
        if let Some(chunk) = self.chunker.finish() {
            self.send(chunk);
        }
        self.sync_header()?;
        self.file
            .sync_all()
            .map_err(|e| format!("Cannot save recording: {e}"))?;
        drop(self.jobs.take());
        let transcript = self
            .worker
            .take()
            .ok_or("Speech engine unavailable")?
            .join()
            .map_err(|_| "Processing was interrupted. Retry this recording.")?;
        Ok(transcript.into_outcome(self.samples))
    }

    /// Stops without transcribing what is still queued.
    pub fn abandon(mut self) {
        self.abandoned.store(true, Ordering::SeqCst);
        drop(self.jobs.take());
        let _ = self.sync_header();
    }
}

const INVALID_MONO_PCM: &str = "Invalid 16-bit mono PCM audio or sample rate.";
const INVALID_PCM: &str = "Invalid 16-bit PCM audio or frame size.";
const FOUR_HOURS: &str = "The recording reached the four-hour limit.";
const FORMAT_CHANGED: &str = "The audio format changed during the recording.";

fn samples_of(pcm: &[u8]) -> Vec<i16> {
    pcm.as_chunks::<2>()
        .0
        .iter()
        .map(|pair| i16::from_le_bytes(*pair))
        .collect()
}

/// How a live recording is kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Quality {
    /// 16 kHz mono, what the speech engine works with.
    Speech,
    /// A 48 kHz Opus copy of one or two channels as well, which replaces the
    /// working WAV once the recording is finished.
    High,
}

impl Quality {
    /// "speech" (the default) or "high".
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value {
            None | Some("speech") => Ok(Self::Speech),
            Some("high") => Ok(Self::High),
            Some(_) => Err("Invalid recording quality.".into()),
        }
    }
}

/// The high-quality copy is tuned for any sound, not only speech, at these
/// rates: about 44 MB an hour in stereo and 29 MB in mono.
const HIGH_BITRATE_STEREO: i32 = 96_000;
const HIGH_BITRATE_MONO: i32 = 64_000;

/// The audio of a recording in progress: its working 16 kHz mono WAV and,
/// for a high-quality recording, the Opus copy written beside it
/// (`{id}.hq.opus`). Each piece goes to both as it arrives.
pub struct LiveAudio {
    wav: PathBuf,
    high_path: PathBuf,
    opus: PathBuf,
    quality: Quality,
    recorder: Recorder,
    /// Made with the first piece, whose format every later piece must have.
    converter: Option<Converter>,
    high: Option<compact_audio::OpusWriter<File>>,
    /// The longest a recording may be, in 16 kHz samples.
    limit: u64,
}

impl LiveAudio {
    pub fn begin(
        directory: &Path,
        id: &str,
        quality: Quality,
        transcribe: Transcriber,
        on_partial: PartialSink,
    ) -> Result<Self, String> {
        let wav = directory.join(format!("{id}.wav"));
        let recorder = Recorder::begin(&wav, transcribe, on_partial)?;
        Ok(Self {
            wav,
            high_path: directory.join(format!("{id}.hq.opus")),
            opus: directory.join(format!("{id}.opus")),
            quality,
            recorder,
            converter: None,
            high: None,
            limit: MAX_SAMPLES,
        })
    }

    /// Adds interleaved samples in `format`. The first piece fixes the
    /// format; every later one must have it and hold whole frames. Returns
    /// the length recorded so far in milliseconds.
    pub fn append(&mut self, format: PcmFormat, samples: &[i16]) -> Result<u64, String> {
        let channels = usize::from(format.channels);
        if samples.is_empty() || !samples.len().is_multiple_of(channels) {
            return Err(invalid_pcm(format).into());
        }
        self.take_format(format)?;
        let Some(converter) = self.converter.as_mut() else {
            return Err(FORMAT_CHANGED.into());
        };
        // Counted on the speech engine's samples, before anything of this
        // piece is written, so the copy never holds more than the WAV.
        if converter.speech_length() >= self.limit {
            return Err(FOUR_HOURS.into());
        }
        let converted = converter.push(samples)?;
        if let Some(high) = self.high.as_mut() {
            if !converted.high.is_empty() {
                high.write(&converted.high)?;
            }
        }
        if !converted.speech.is_empty() {
            self.recorder.append_samples(&converted.speech)?;
        }
        Ok(self.recorder.recorded_ms())
    }

    /// Fixes the format with the first piece, and starts the high-quality
    /// copy then, when it has the channels to know.
    fn take_format(&mut self, format: PcmFormat) -> Result<(), String> {
        if let Some(converter) = &self.converter {
            return if converter.format() == format {
                Ok(())
            } else {
                Err(FORMAT_CHANGED.into())
            };
        }
        let converter = Converter::new(format, self.quality == Quality::High)?;
        if let Some(channels) = converter.high_channels() {
            let bitrate = if channels == 2 {
                HIGH_BITRATE_STEREO
            } else {
                HIGH_BITRATE_MONO
            };
            self.high = Some(compact_audio::OpusWriter::create(
                &self.high_path,
                HIGH_RATE,
                channels,
                bitrate,
                opus::Application::Audio,
            )?);
        }
        self.converter = Some(converter);
        Ok(())
    }

    /// What the converter still holds goes to the copy and the WAV.
    fn flush(&mut self) -> Result<(), String> {
        let Some(converter) = self.converter.as_mut() else {
            return Ok(());
        };
        let rest = converter.finish()?;
        if let Some(high) = self.high.as_mut() {
            if !rest.high.is_empty() {
                high.write(&rest.high)?;
            }
        }
        self.recorder.append_last(&rest.speech)
    }

    /// Transcribes what is left and waits for the engine. A high-quality
    /// copy then takes the WAV's place; should that fail, the WAV stays,
    /// with the whole recording, and the copy left beside it is taken up
    /// later (see `compact_audio::compress`).
    pub fn finish(mut self) -> Result<Outcome, String> {
        self.flush()?;
        let outcome = self.recorder.finish()?;
        if let Some(high) = self.high.take() {
            if high.finish().is_ok() && fs::rename(&self.high_path, &self.opus).is_ok() {
                // Left behind, the WAV is removed by the next compression.
                let _ = fs::remove_file(&self.wav);
            }
        }
        Ok(outcome)
    }

    /// Stops without transcribing what is still queued. The WAV stays, and
    /// a high-quality copy is completed beside it, to take its place later
    /// as a copy a crash left would.
    pub fn abandon(mut self) {
        let _ = self.flush();
        self.recorder.abandon();
        if let Some(high) = self.high.take() {
            let _ = high.finish();
        }
    }

    /// Stops and removes the high-quality copy. The caller removes the rest.
    pub fn cancel(mut self) {
        self.recorder.abandon();
        // Closed before it is removed: Windows keeps open files.
        drop(self.high.take());
        let _ = fs::remove_file(&self.high_path);
    }
}

fn invalid_pcm(format: PcmFormat) -> &'static str {
    if format.channels == 1 {
        INVALID_MONO_PCM
    } else {
        INVALID_PCM
    }
}

/// Transcribes a saved recording chunk by chunk, however long it is and
/// whichever format it is kept in.
pub fn transcribe_file(
    audio_path: &Path,
    transcribe: Transcriber,
    on_partial: PartialSink,
) -> Result<Outcome, String> {
    if compact_audio::is_compressed(audio_path) {
        return transcribe_samples(compact_audio::open(audio_path)?, transcribe, on_partial);
    }
    // Counts the last seconds of a recording cut off by a crash, which its
    // header was not brought up to date with.
    let reader = compact_audio::open_wav(audio_path)?;
    let spec = reader.spec();
    if spec.channels != 1
        || u64::from(spec.sample_rate) != SAMPLE_RATE
        || spec.bits_per_sample != 16
        || spec.sample_format != hound::SampleFormat::Int
    {
        return Err("Local speech requires mono 16 kHz PCM audio.".into());
    }
    transcribe_samples(
        reader
            .into_samples::<i16>()
            .map(|sample| sample.map_err(|e| format!("Invalid WAV audio: {e}"))),
        transcribe,
        on_partial,
    )
}

fn transcribe_samples(
    samples: impl Iterator<Item = Result<i16, String>>,
    transcribe: Transcriber,
    on_partial: PartialSink,
) -> Result<Outcome, String> {
    let mut transcript = Transcript::new(transcribe, on_partial);
    let mut chunker = Chunker::default();
    let mut block = Vec::with_capacity(SAMPLE_RATE as usize);
    let mut total = 0u64;
    for sample in samples {
        block.push(sample?);
        if block.len() == SAMPLE_RATE as usize {
            total += block.len() as u64;
            for chunk in chunker.push(&block) {
                transcript.add(&chunk);
            }
            block.clear();
        }
    }
    total += block.len() as u64;
    for chunk in chunker.push(&block) {
        transcript.add(&chunk);
    }
    if let Some(chunk) = chunker.finish() {
        transcript.add(&chunk);
    }
    if total == 0 {
        return Err("No audio was recorded.".into());
    }
    Ok(transcript.into_outcome(total))
}

// ── Commands ──────────────────────────────────────────────────────────

struct Live {
    id: String,
    record: local_history::Capture,
    audio: LiveAudio,
    /// Keeps the WAV from being compressed while it is still being written.
    hold: compact_audio::Hold,
}

/// What a command answers when its recording has ended or was replaced.
pub const NOT_IN_PROGRESS: &str = "This recording is no longer in progress.";

/// The one recording in progress. The microphone is a single device, so a
/// second recording replaces a first that was never finished.
static LIVE: Mutex<Option<Live>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PartialEvent {
    capture_id: String,
    segments: Vec<WhisperSegment>,
}

fn partial_sink(app: &tauri::AppHandle, id: &str) -> PartialSink {
    let app = app.clone();
    let capture_id = id.to_owned();
    Box::new(move |segments| {
        let _ = app.emit(
            "capture-partial",
            PartialEvent {
                capture_id: capture_id.clone(),
                segments: segments.to_vec(),
            },
        );
    })
}

/// What transcribes each chunk: an online model when one is named, otherwise
/// the local engine. Both are checked here, before any audio is recorded.
fn transcriber(
    app: &tauri::AppHandle,
    language: Option<String>,
    model_path: Option<String>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<Transcriber, String> {
    let language = language.filter(|l| !l.trim().is_empty() && l != "auto");
    if let Some(provider) = provider.filter(|p| !p.is_empty() && p != "local") {
        return Ok(Box::new(super::online::chunk_transcriber(
            provider,
            model.unwrap_or_default(),
            language,
        )?));
    }
    let model_path = super::local_engine::resolve_model(app, model_path)?;
    Ok(Box::new(move |samples: &[i16]| {
        let audio: Vec<f32> = samples.iter().map(|s| f32::from(*s) / 32768.0).collect();
        super::local_engine::transcribe_samples(&model_path, &audio, language.clone())
    }))
}

fn finished(
    record: &mut local_history::Capture,
    outcome: Outcome,
) -> Result<WhisperResult, String> {
    record.duration_ms = outcome.duration_ms;
    record.language = outcome.language.clone().or(record.language.take());
    match outcome.error {
        Some(error) => {
            // Keep what was understood before the failure; retry redoes it all.
            record.transcript = (!outcome.text.is_empty()).then_some(outcome.text);
            record.segments = outcome.segments;
            record.error = Some(error.clone());
            Err(error)
        }
        None => {
            record.transcript = Some(outcome.text.clone());
            record.segments = outcome.segments.clone();
            record.error = None;
            Ok(WhisperResult {
                text: outcome.text,
                segments: outcome.segments,
                language: outcome.language,
                capture_id: Some(record.id.clone()),
            })
        }
    }
}

/// Starts a live recording and returns its ID. `quality` is "speech" (the
/// default) or "high", which keeps a 48 kHz Opus copy of what is recorded.
#[tauri::command(async)]
pub fn capture_begin(
    app: tauri::AppHandle,
    language: Option<String>,
    model_path: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    quality: Option<String>,
) -> Result<String, String> {
    let quality = Quality::parse(quality.as_deref())?;
    let transcribe = transcriber(&app, language.clone(), model_path, provider, model)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let id = format!("{}-{}", now.as_nanos(), std::process::id());
    let directory = local_history::directory(&app)?;
    let mut record = local_history::Capture {
        id: id.clone(),
        created_at_ms: now.as_millis() as u64,
        duration_ms: 0,
        transcript: None,
        error: Some("Processing was interrupted. Retry this recording.".into()),
        language,
        ..Default::default()
    };
    let hold = compact_audio::hold(&id);
    let audio = LiveAudio::begin(
        &directory,
        &id,
        quality,
        transcribe,
        partial_sink(&app, &id),
    )?;
    local_history::write_record(&app, &mut record)?;
    let previous = LIVE
        .lock()
        .map_err(|_| "Speech engine unavailable")?
        .replace(Live {
            id: id.clone(),
            record,
            audio,
            hold,
        });
    if let Some(previous) = previous {
        // Never finished (the window was reloaded, say). Its audio stays in
        // the library, marked for retry.
        previous.audio.abandon();
    }
    Ok(id)
}

/// Adds audio to the live recording. The raw IPC body is interleaved 16-bit
/// PCM, 16 kHz mono unless `x-sonolect-rate` and `x-sonolect-channels` say
/// otherwise; the recording's ID travels in `x-sonolect-capture`. Returns
/// the recorded length in milliseconds.
#[tauri::command(async)]
pub fn capture_append(request: tauri::ipc::Request<'_>) -> Result<u64, String> {
    let id = super::ipc_audio::header(&request, "x-sonolect-capture").unwrap_or_default();
    let format = super::ipc_audio::pcm_format(&request)?;
    let pcm = super::ipc_audio::pcm_chunk(&request)?;
    if pcm.len() & 1 == 1 {
        return Err(invalid_pcm(format).into());
    }
    append_live(&id, format, &samples_of(&pcm))
}

/// Adds interleaved samples in `format` to the live recording, from the
/// window or a native source (system audio). Returns the recorded length in
/// milliseconds.
pub fn append_live(id: &str, format: PcmFormat, samples: &[i16]) -> Result<u64, String> {
    let mut live = LIVE.lock().map_err(|_| "Speech engine unavailable")?;
    match live.as_mut().filter(|live| live.id == id) {
        Some(live) => live.audio.append(format, samples),
        None => Err(NOT_IN_PROGRESS.into()),
    }
}

/// How the recording `id` is kept, while it is in progress.
pub fn live_quality(id: &str) -> Option<Quality> {
    LIVE.lock().ok().and_then(|live| {
        live.as_ref()
            .filter(|live| live.id == id)
            .map(|live| live.audio.quality)
    })
}

/// The ID of the recording in progress, if any.
pub fn live_id() -> Option<String> {
    LIVE.lock()
        .ok()
        .and_then(|live| live.as_ref().map(|live| live.id.clone()))
}

fn take_live(id: &str) -> Result<Live, String> {
    let mut live = LIVE.lock().map_err(|_| "Speech engine unavailable")?;
    if live.as_ref().is_some_and(|live| live.id == id) {
        live.take().ok_or_else(|| NOT_IN_PROGRESS.into())
    } else {
        Err(NOT_IN_PROGRESS.into())
    }
}

/// Ends the live recording and returns its full transcript.
#[tauri::command]
pub async fn capture_finish(app: tauri::AppHandle, id: String) -> Result<WhisperResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // `_hold` lasts until the record is written.
        let Live {
            id,
            mut record,
            audio,
            hold: _hold,
        } = take_live(&id)?;
        let outcome = audio.finish()?;
        if outcome.duration_ms == 0 {
            local_history::discard(&app, &id)?;
            return Err("No audio was recorded.".into());
        }
        let result = finished(&mut record, outcome);
        local_history::write_record(&app, &mut record)?;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the live recording and throws its audio away.
#[tauri::command(async)]
pub fn capture_cancel(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let live = take_live(&id)?;
    live.audio.cancel();
    local_history::discard(&app, &live.id)
}

/// Transcribes a saved recording again, in chunks, whatever its length.
pub fn retranscribe(
    app: &tauri::AppHandle,
    id: &str,
    model_path: Option<String>,
    language: Option<String>,
) -> Result<WhisperResult, String> {
    let directory = local_history::directory(app)?;
    let _hold = compact_audio::hold(id);
    let wav = compact_audio::audio_file(&directory, id)
        .unwrap_or_else(|| directory.join(format!("{id}.wav")));
    let transcribe = transcriber(app, language.clone(), model_path, None, None)?;
    let outcome = transcribe_file(&wav, transcribe, partial_sink(app, id));
    // Read again now: a change that came through sync while this ran stays.
    local_history::change_record(
        app,
        id,
        || local_history::Capture {
            id: id.to_owned(),
            created_at_ms: modified_ms(&wav),
            language,
            ..Default::default()
        },
        |record| match outcome {
            Ok(outcome) => finished(record, outcome),
            Err(error) => {
                record.error = Some(error.clone());
                Err(error)
            }
        },
    )?
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as TestMutex;

    /// A 220 Hz tone, loud enough to count as speech.
    fn speech(seconds: f32) -> Vec<i16> {
        (0..(seconds * SAMPLE_RATE as f32) as usize)
            .map(|i| ((i as f32 * 220.0 * std::f32::consts::TAU / 16000.0).sin() * 8000.0) as i16)
            .collect()
    }

    fn silence(seconds: f32) -> Vec<i16> {
        vec![0; (seconds * SAMPLE_RATE as f32) as usize]
    }

    fn pcm(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    /// Answers each chunk with one segment that names its length.
    fn fake_engine() -> Transcriber {
        Box::new(|samples| {
            let ms = samples.len() as u64 * 1000 / SAMPLE_RATE;
            Ok(WhisperResult {
                text: String::new(),
                segments: vec![WhisperSegment {
                    start_ms: 100,
                    end_ms: ms + 5000,
                    text: format!("{ms} ms"),
                    ..Default::default()
                }],
                language: Some("en".into()),
                capture_id: None,
            })
        })
    }

    fn collector() -> (Arc<TestMutex<Vec<WhisperSegment>>>, PartialSink) {
        let seen = Arc::new(TestMutex::new(vec![]));
        let sink = Arc::clone(&seen);
        (
            seen,
            Box::new(move |segments| sink.lock().unwrap().extend_from_slice(segments)),
        )
    }

    #[test]
    fn cuts_at_the_first_pause_after_the_minimum_length() {
        let mut chunker = Chunker::default();
        let mut audio = speech(4.0);
        audio.extend(silence(1.0));
        audio.extend(speech(1.0));
        let chunks = chunker.push(&audio);
        assert_eq!(chunks.len(), 1);
        let cut = chunks[0].samples.len();
        // Inside the pause, leaving a little silence on both sides.
        assert!(cut > 4 * 16000 && cut < 4 * 16000 + 8000, "{cut}");
        assert_eq!(chunks[0].start_sample, 0);
        assert!(!chunks[0].silent);
        let tail = chunker.finish().unwrap();
        assert_eq!(tail.start_sample, cut as u64);
        assert_eq!(cut + tail.samples.len(), audio.len());
        assert!(chunker.finish().is_none());
    }

    #[test]
    fn a_pause_before_the_minimum_length_does_not_cut() {
        let mut chunker = Chunker::default();
        let mut audio = speech(1.0);
        audio.extend(silence(0.5));
        audio.extend(speech(1.0));
        assert!(chunker.push(&audio).is_empty());
        // The next pause, after three seconds, does.
        let mut more = speech(1.0);
        more.extend(silence(0.5));
        assert_eq!(chunker.push(&more).len(), 1);
    }

    #[test]
    fn speech_without_a_pause_is_cut_before_the_engine_window() {
        let mut chunker = Chunker::default();
        let mut cut = 0;
        for _ in 0..60 {
            for chunk in chunker.push(&speech(0.5)) {
                assert!(chunk.samples.len() <= MAX_CHUNK);
                assert!(chunk.samples.len() >= 20 * 16000);
                assert_eq!(chunk.start_sample, cut);
                cut += chunk.samples.len() as u64;
            }
        }
        assert!(cut > 0);
    }

    #[test]
    fn long_silence_is_handed_over_as_silent_chunks() {
        let mut chunker = Chunker::default();
        let mut silent = 0;
        for _ in 0..40 {
            for chunk in chunker.push(&silence(0.5)) {
                assert!(chunk.silent);
                silent += chunk.samples.len();
            }
        }
        assert!(silent >= 17 * 16000, "{silent}");
        assert!(chunker.pending.len() < MIN_CHUNK);
    }

    #[test]
    fn records_a_valid_wav_and_times_segments_on_the_recording_clock() {
        let folder = tempfile::tempdir().unwrap();
        let wav = folder.path().join("1-1.wav");
        let (seen, sink) = collector();
        let mut recorder = Recorder::begin(&wav, fake_engine(), sink).unwrap();
        let mut audio = speech(4.0);
        audio.extend(silence(6.0));
        audio.extend(speech(2.0));
        // Half-second pieces, as the web layer sends them.
        for piece in audio.chunks(8000) {
            recorder.append(&pcm(piece)).unwrap();
        }
        // Readable while recording: the header is kept up to date.
        let partial = hound::WavReader::open(&wav).unwrap();
        assert!(partial.duration() >= 5 * 16000);
        drop(partial);

        let outcome = recorder.finish().unwrap();
        assert_eq!(outcome.duration_ms, 12_000);
        assert_eq!(outcome.error, None);
        assert_eq!(outcome.language.as_deref(), Some("en"));
        // The silence in the middle was never sent to the engine.
        assert_eq!(outcome.segments.len(), 2);
        let first = &outcome.segments[0];
        assert_eq!(first.start_ms, 100);
        // An end time past the chunk is clamped to the chunk.
        assert!(first.end_ms > 4000 && first.end_ms < 4500, "{first:?}");
        let second = &outcome.segments[1];
        // The last chunk starts inside the long silence, after the part that
        // was skipped.
        assert!(
            second.start_ms > 7000 && second.start_ms < 10_000 && second.end_ms == 12_000,
            "{second:?}"
        );
        assert_eq!(outcome.text, format!("{} {}", first.text, second.text));
        assert_eq!(*seen.lock().unwrap(), outcome.segments);

        let mut saved = hound::WavReader::open(&wav).unwrap();
        assert_eq!(saved.duration() as usize, audio.len());
        let read: Vec<i16> = saved.samples::<i16>().map(Result::unwrap).collect();
        assert_eq!(read, audio);
    }

    #[test]
    fn a_failing_engine_keeps_the_audio_and_reports_the_first_error() {
        let folder = tempfile::tempdir().unwrap();
        let wav = folder.path().join("2-1.wav");
        let mut calls = 0;
        let engine: Transcriber = Box::new(move |_| {
            calls += 1;
            Err(format!("failure {calls}"))
        });
        let mut recorder = Recorder::begin(&wav, engine, Box::new(|_| {})).unwrap();
        for _ in 0..3 {
            let mut audio = speech(4.0);
            audio.extend(silence(1.0));
            recorder.append(&pcm(&audio)).unwrap();
        }
        let outcome = recorder.finish().unwrap();
        assert_eq!(outcome.error.as_deref(), Some("failure 1"));
        assert!(outcome.segments.is_empty());
        assert_eq!(hound::WavReader::open(&wav).unwrap().duration(), 15 * 16000);
    }

    #[test]
    fn refuses_odd_or_empty_audio_and_stops_at_four_hours() {
        let folder = tempfile::tempdir().unwrap();
        let mut recorder = Recorder::begin(
            &folder.path().join("3-1.wav"),
            fake_engine(),
            Box::new(|_| {}),
        )
        .unwrap();
        assert!(recorder.append(&[]).is_err());
        assert!(recorder.append(&[1, 2, 3]).is_err());
        assert_eq!(recorder.append(&[0; 32]).unwrap(), 1);
        recorder.samples = MAX_SAMPLES;
        assert_eq!(
            recorder.append(&[0; 32]).unwrap_err(),
            "The recording reached the four-hour limit."
        );
        recorder.abandon();
    }

    #[test]
    fn text_without_timings_spans_its_chunk() {
        let folder = tempfile::tempdir().unwrap();
        let wav = folder.path().join("4-1.wav");
        let engine: Transcriber = Box::new(|_| {
            Ok(WhisperResult {
                text: " online text ".into(),
                segments: vec![],
                language: None,
                capture_id: None,
            })
        });
        let mut recorder = Recorder::begin(&wav, engine, Box::new(|_| {})).unwrap();
        recorder.append(&pcm(&silence(3.0))).unwrap();
        recorder.append(&pcm(&speech(2.0))).unwrap();
        let outcome = recorder.finish().unwrap();
        assert_eq!(outcome.segments.len(), 1);
        assert_eq!(outcome.segments[0].text, "online text");
        assert_eq!(outcome.segments[0].start_ms, 3000);
        assert_eq!(outcome.segments[0].end_ms, 5000);
    }

    #[test]
    fn a_saved_recording_is_transcribed_again_in_chunks() {
        let folder = tempfile::tempdir().unwrap();
        let wav = folder.path().join("5-1.wav");
        let mut audio = Vec::new();
        for _ in 0..10 {
            audio.extend(speech(5.0));
            audio.extend(silence(1.0));
        }
        fs::write(&wav, wav_bytes(&audio)).unwrap();
        let (seen, sink) = collector();
        let outcome = transcribe_file(&wav, fake_engine(), sink).unwrap();
        assert_eq!(outcome.duration_ms, 60_000);
        assert_eq!(outcome.segments.len(), 10);
        assert_eq!(seen.lock().unwrap().len(), 10);
        assert!(outcome
            .segments
            .windows(2)
            .all(|pair| pair[0].end_ms <= pair[1].start_ms));

        fs::write(&wav, wav_bytes(&[])).unwrap();
        assert_eq!(
            transcribe_file(&wav, fake_engine(), Box::new(|_| {})).unwrap_err(),
            "No audio was recorded."
        );
    }

    #[test]
    fn a_recording_cut_off_by_a_crash_is_transcribed_to_its_end() {
        let folder = tempfile::tempdir().unwrap();
        let recording = folder.path().join("7-1.wav");
        let mut recorder = Recorder::begin(&recording, fake_engine(), Box::new(|_| {})).unwrap();
        let mut audio = speech(5.0);
        audio.extend(silence(1.0));
        audio.extend(speech(3.5));
        for piece in audio.chunks(8000) {
            recorder.append(&pcm(piece)).unwrap();
        }
        // What is on disk when the app is killed now: the header was last
        // brought up to date at five seconds, but all 9.5 seconds are there.
        let wav = folder.path().join("8-1.wav");
        fs::copy(&recording, &wav).unwrap();
        recorder.abandon();
        assert_eq!(hound::WavReader::open(&wav).unwrap().duration(), 5 * 16_000);

        let outcome = transcribe_file(&wav, fake_engine(), Box::new(|_| {})).unwrap();
        assert_eq!(outcome.duration_ms, 9_500);
        assert_eq!(outcome.segments.last().unwrap().end_ms, 9_500);
        // And the file now says so too.
        assert_eq!(
            hound::WavReader::open(&wav).unwrap().duration() as usize,
            audio.len()
        );
    }

    #[test]
    fn a_compressed_recording_is_transcribed_like_the_original() {
        let folder = tempfile::tempdir().unwrap();
        let mut audio = Vec::new();
        for _ in 0..10 {
            audio.extend(speech(5.0));
            audio.extend(silence(1.0));
        }
        fs::write(folder.path().join("6-1.wav"), wav_bytes(&audio)).unwrap();
        assert!(compact_audio::compress(folder.path(), "6-1").unwrap() > 0);
        let opus = compact_audio::audio_file(folder.path(), "6-1").unwrap();
        assert!(compact_audio::is_compressed(&opus));
        let (seen, sink) = collector();
        let outcome = transcribe_file(&opus, fake_engine(), sink).unwrap();
        // Same length and the same pauses found as in the WAV.
        assert_eq!(outcome.duration_ms, 60_000);
        assert_eq!(outcome.segments.len(), 10);
        assert_eq!(seen.lock().unwrap().len(), 10);

        fs::write(&opus, b"not audio").unwrap();
        assert_eq!(
            transcribe_file(&opus, fake_engine(), Box::new(|_| {})).unwrap_err(),
            "Invalid compressed audio."
        );
    }

    /// `seconds` of 48 kHz audio: a 220 Hz tone on the left and, in
    /// stereo, 3 kHz on the right, interleaved.
    fn high(seconds: f32, channels: usize) -> Vec<i16> {
        (0..(seconds * 48_000.0) as usize)
            .flat_map(|i| {
                let t = i as f32 / 48_000.0;
                [220.0f32, 3000.0]
                    .into_iter()
                    .take(channels)
                    .map(move |hz| ((t * hz * std::f32::consts::TAU).sin() * 8000.0) as i16)
            })
            .collect()
    }

    fn stereo_48k() -> PcmFormat {
        PcmFormat::new(48_000, 2).unwrap()
    }

    fn files(folder: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(folder)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }

    fn live(folder: &Path, id: &str, quality: Quality) -> LiveAudio {
        LiveAudio::begin(folder, id, quality, fake_engine(), Box::new(|_| {})).unwrap()
    }

    #[test]
    fn a_high_quality_recording_keeps_a_working_wav_and_ends_as_one_opus_file() {
        let folder = tempfile::tempdir().unwrap();
        let (seen, sink) = collector();
        let mut audio =
            LiveAudio::begin(folder.path(), "11-1", Quality::High, fake_engine(), sink).unwrap();
        let mut sent = high(4.0, 2);
        sent.extend(vec![0; 2 * 48_000 * 6]);
        sent.extend(high(2.0, 2));
        // Half-second pieces, as the web layer sends them.
        let mut recorded = 0;
        for piece in sent.chunks(2 * 24_000) {
            recorded = audio.append(stereo_48k(), piece).unwrap();
        }
        assert!(recorded > 11_900 && recorded <= 12_000, "{recorded}");
        // While recording: the 16 kHz WAV the engine reads, and the copy.
        assert_eq!(files(folder.path()), ["11-1.hq.opus", "11-1.wav"]);
        let wav = hound::WavReader::open(folder.path().join("11-1.wav")).unwrap();
        assert_eq!((wav.spec().sample_rate, wav.spec().channels), (16_000, 1));
        assert!(wav.duration() >= 10 * 16_000);
        drop(wav);

        let outcome = audio.finish().unwrap();
        // The WAV had exactly the recording's length, to the sample.
        assert_eq!(outcome.duration_ms, 12_000);
        assert_eq!(outcome.segments.len(), 2);
        assert_eq!(*seen.lock().unwrap(), outcome.segments);
        // One Opus file is left: two channels, the recording's length.
        assert_eq!(files(folder.path()), ["11-1.opus"]);
        let opus = folder.path().join("11-1.opus");
        let bytes = fs::read(&opus).unwrap();
        assert_eq!((bytes[28 + 9], &bytes[28..36]), (2, &b"OpusHead"[..]));
        assert_eq!(compact_audio::open(&opus).unwrap().count(), 12 * 16_000);
        // And it is transcribed again like any recording.
        let again = transcribe_file(&opus, fake_engine(), Box::new(|_| {})).unwrap();
        assert_eq!(again.duration_ms, 12_000);
        assert_eq!(again.segments.len(), 2);
    }

    #[test]
    fn a_high_quality_mono_source_keeps_a_mono_copy_at_48_khz() {
        let folder = tempfile::tempdir().unwrap();
        let mut audio = live(folder.path(), "12-1", Quality::High);
        // A 44.1 kHz microphone, resampled on the way.
        let format = PcmFormat::new(44_100, 1).unwrap();
        let samples: Vec<i16> = (0..44_100 * 2)
            .map(|i| ((i as f32 * 440.0 * std::f32::consts::TAU / 44_100.0).sin() * 8000.0) as i16)
            .collect();
        for piece in samples.chunks(22_050) {
            audio.append(format, piece).unwrap();
        }
        assert_eq!(audio.finish().unwrap().duration_ms, 2_000);
        let opus = folder.path().join("12-1.opus");
        assert_eq!(fs::read(&opus).unwrap()[28 + 9], 1);
        assert_eq!(compact_audio::open(&opus).unwrap().count(), 2 * 16_000);
        assert_eq!(files(folder.path()), ["12-1.opus"]);
    }

    #[test]
    fn a_speech_quality_recording_is_a_wav_as_before() {
        let folder = tempfile::tempdir().unwrap();
        let mut audio = live(folder.path(), "13-1", Quality::Speech);
        let sent = speech(3.0);
        for piece in sent.chunks(8000) {
            audio.append(PcmFormat::SPEECH, piece).unwrap();
        }
        assert_eq!(audio.finish().unwrap().duration_ms, 3_000);
        assert_eq!(files(folder.path()), ["13-1.wav"]);
        let mut saved = hound::WavReader::open(folder.path().join("13-1.wav")).unwrap();
        let read: Vec<i16> = saved.samples::<i16>().map(Result::unwrap).collect();
        assert_eq!(read, sent);

        // 48 kHz stereo sent for a speech-quality recording: only the WAV.
        let mut audio = live(folder.path(), "14-1", Quality::Speech);
        audio.append(stereo_48k(), &high(1.0, 2)).unwrap();
        assert_eq!(audio.finish().unwrap().duration_ms, 1_000);
        assert_eq!(files(folder.path()), ["13-1.wav", "14-1.wav"]);
    }

    #[test]
    fn the_first_piece_fixes_the_format_and_every_piece_holds_whole_frames() {
        let folder = tempfile::tempdir().unwrap();
        let mut audio = live(folder.path(), "15-1", Quality::High);
        // Refused pieces fix nothing.
        assert_eq!(
            audio.append(stereo_48k(), &[1, 2, 3]).unwrap_err(),
            INVALID_PCM
        );
        assert_eq!(audio.append(stereo_48k(), &[]).unwrap_err(), INVALID_PCM);
        assert_eq!(
            audio.append(PcmFormat::SPEECH, &[]).unwrap_err(),
            INVALID_MONO_PCM
        );
        assert!(audio.converter.is_none() && audio.high.is_none());
        audio.append(stereo_48k(), &high(0.5, 2)).unwrap();
        for other in [
            PcmFormat::SPEECH,
            PcmFormat::new(48_000, 1).unwrap(),
            PcmFormat::new(44_100, 2).unwrap(),
        ] {
            assert_eq!(
                audio.append(other, &[0; 960]).unwrap_err(),
                FORMAT_CHANGED,
                "{other:?}"
            );
        }
        assert_eq!(
            audio.append(stereo_48k(), &[0; 961]).unwrap_err(),
            INVALID_PCM
        );
        // Nothing refused reached either file.
        assert_eq!(audio.finish().unwrap().duration_ms, 500);
        let opus = folder.path().join("15-1.opus");
        assert_eq!(compact_audio::open(&opus).unwrap().count(), 8_000);
    }

    #[test]
    fn the_four_hour_limit_counts_speech_samples_before_anything_is_written() {
        let folder = tempfile::tempdir().unwrap();
        let mut audio = live(folder.path(), "16-1", Quality::High);
        // A one-second limit stands in for four hours.
        audio.limit = 16_000;
        // A 44.1 kHz stereo device: 0.6 s pieces.
        let format = PcmFormat::new(44_100, 2).unwrap();
        let piece = vec![1000i16; 2 * 26_460];
        audio.append(format, &piece).unwrap();
        audio.append(format, &piece).unwrap();
        // 1.2 s counted: no more, and nothing of the refused piece is kept.
        assert_eq!(audio.append(format, &piece).unwrap_err(), FOUR_HOURS);
        assert_eq!(audio.append(format, &piece).unwrap_err(), FOUR_HOURS);
        let outcome = audio.finish().unwrap();
        assert_eq!(outcome.duration_ms, 1_200);
        let opus = folder.path().join("16-1.opus");
        assert_eq!(compact_audio::open(&opus).unwrap().count(), 19_200);

        // At 16 kHz mono the limit is the recorder's, as before.
        let mut audio = live(folder.path(), "17-1", Quality::Speech);
        audio.limit = 16_000;
        audio.append(PcmFormat::SPEECH, &[0; 16_000]).unwrap();
        assert_eq!(
            audio.append(PcmFormat::SPEECH, &[0; 10]).unwrap_err(),
            FOUR_HOURS
        );
        audio.abandon();
    }

    #[test]
    fn cancelling_removes_the_copy_and_abandoning_completes_it() {
        let folder = tempfile::tempdir().unwrap();
        let mut audio = live(folder.path(), "18-1", Quality::High);
        audio.append(stereo_48k(), &high(1.5, 2)).unwrap();
        audio.cancel();
        // The caller then removes the WAV and the record.
        assert_eq!(files(folder.path()), ["18-1.wav"]);

        // Replaced before it was finished (the window was reloaded): the
        // WAV stays for a retry, and the copy is complete beside it, to take
        // its place.
        let mut audio = live(folder.path(), "19-1", Quality::High);
        for piece in high(2.0, 2).chunks(2 * 24_000) {
            audio.append(stereo_48k(), piece).unwrap();
        }
        audio.abandon();
        assert_eq!(
            files(folder.path()),
            ["18-1.wav", "19-1.hq.opus", "19-1.wav"]
        );
        assert_eq!(
            hound::WavReader::open(folder.path().join("19-1.wav"))
                .unwrap()
                .duration(),
            2 * 16_000
        );
        assert!(compact_audio::compress(folder.path(), "19-1").unwrap() > 0);
        assert_eq!(files(folder.path()), ["18-1.wav", "19-1.opus"]);
        let opus = folder.path().join("19-1.opus");
        assert_eq!(compact_audio::open(&opus).unwrap().count(), 2 * 16_000);
    }

    #[test]
    fn recording_quality_is_speech_unless_asked_for_high() {
        assert_eq!(Quality::parse(None), Ok(Quality::Speech));
        assert_eq!(Quality::parse(Some("speech")), Ok(Quality::Speech));
        assert_eq!(Quality::parse(Some("high")), Ok(Quality::High));
        for other in ["", "HIGH", "hq", "lossless"] {
            assert!(Quality::parse(Some(other)).is_err(), "{other}");
        }
    }

    #[test]
    fn wav_bytes_round_trip() {
        let audio = speech(0.25);
        let bytes = wav_bytes(&audio);
        assert_eq!(bytes.len(), 44 + audio.len() * 2);
        let mut reader = hound::WavReader::new(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(reader.spec().sample_rate, 16000);
        let read: Vec<i16> = reader.samples::<i16>().map(Result::unwrap).collect();
        assert_eq!(read, audio);
    }
}
