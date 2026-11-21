//! On-device speaker detection: who spoke when in a saved recording.
//!
//! The recording is read twice, a piece at a time, so a long one never sits
//! in memory whole:
//!
//! 1. The first pass measures the loudness of every 20 ms. Speech is what is
//!    louder than the live chunker's pause level; pauses under 300 ms are
//!    bridged and blips under 200 ms dropped.
//! 2. The second pass cuts the speech into 1.5 s windows every 0.75 s and
//!    turns each window into a voice print: Kaldi filterbank features, then
//!    the CAM++ speaker-embedding model from 3D-Speaker, run by tract in pure
//!    Rust on up to four threads. Only the 192 numbers of each print are
//!    kept, a few megabytes for an hour of speech.
//!
//! Windows with at least a second of speech are grouped by average-linkage
//! clustering of their cosine distances, and groups too small to be a person
//! are dissolved. Every window then joins the nearest group, each 10 ms of
//! speech takes the speaker of the nearest window, and the result becomes
//! turns numbered by first appearance.
//!
//! A cancel is honoured at every step, the grouping included: a cancelled run
//! returns an error, never turns.
//!
//! Nothing leaves the device. The model is downloaded only when the user asks
//! for it, and its size and SHA-256 are checked before every load, so the
//! ONNX parser only ever reads the pinned file.
use serde::Serialize;
use std::{
    cell::Cell,
    collections::VecDeque,
    fs::{self, File},
    io::{self, BufReader, Read, Seek, SeekFrom},
    panic::{self, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, TryLockError,
    },
};
use tauri::{Emitter, Manager};
use tract_onnx::prelude::*;

use super::{
    compact_audio,
    fbank::{self, Fbank},
    local_history,
    model_download::{self, PinnedModel, Unusable},
    streaming,
};

/// The speaker-embedding model: CAM++ from 3D-Speaker (Chinese and English
/// speech, 16 kHz), as converted to ONNX by the sherpa-onnx project. To serve
/// it from a mirror, change `url` only: the size and the SHA-256 pin the file
/// itself. (The upstream release tag really is spelt "recongition".)
pub const SPEAKER_MODEL: PinnedModel = PinnedModel {
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    sha256: "53cab20ba8f2eb2f6e2d89ecc18e88ef3222169b61b4419cbc13666744a4574b",
    size: 28_281_165,
};
/// The model's file name in the app's `models` folder, next to Whisper's.
const MODEL_FILE: &str = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx";

const CANCELLED: &str = "Speaker detection was cancelled.";
const BUSY: &str = "Speaker detection is already running.";
const COUNT: &str = "Choose between 2 and 8 speakers.";
const MISSING: &str = "Download the speaker model first.";
const DAMAGED: &str = "The speaker model was damaged and has been removed. Download it again.";
const STILL_RECORDING: &str = "Finish the recording before detecting speakers.";

const SAMPLE_RATE: usize = compact_audio::SAMPLE_RATE as usize;
/// Loudness is measured in 20 ms frames, as the live chunker does.
const LEVEL_FRAME: usize = 320;
/// Pauses shorter than 300 ms do not end a stretch of speech.
const BRIDGED_FRAMES: usize = 15;
/// Stretches shorter than 200 ms are clicks and breaths, not speech.
const SHORTEST_SPEECH_FRAMES: usize = 10;
/// Each voice print listens to 1.5 s of speech...
const WINDOW: usize = SAMPLE_RATE * 3 / 2;
/// ...and a new one starts every 0.75 s.
const HOP: usize = WINDOW / 2;
/// The model always reads 150 rows of features, 1.5 s, so that one fixed
/// shape serves every window: a fixed shape runs about twice as fast.
const MODEL_FRAMES: usize = WINDOW / fbank::SHIFT;
/// The numbers in a voice print.
const EMBEDDING: usize = 192;
/// Windows with at least a second of speech are steady enough to cluster.
const RELIABLE: usize = SAMPLE_RATE;
/// Clustering compares every pair, so it looks at no more windows than this.
const MAX_CLUSTERED: usize = 2000;
/// In Auto mode, groups closer than this cosine distance are one speaker.
const AUTO_DISTANCE: f32 = 0.55;
/// A speaker needs at least this share of the clustered windows...
const SMALLEST_SHARE: f32 = 0.02;
/// ...and at least this many of them.
const SMALLEST_GROUP: usize = 4;
/// A turn shorter than this is given to the turn it runs into.
const SHORTEST_TURN: usize = SAMPLE_RATE / 2;
/// Threads that work out voice prints, at most.
const MAX_THREADS: usize = 4;
/// The share of the progress bar the first pass takes.
const FIRST_PASS_PERCENT: u64 = 10;

/// One stretch of speech by one speaker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerTurn {
    pub start_ms: u64,
    pub end_ms: u64,
    /// 1 for the first voice heard, 2 for the next new one, and so on.
    pub speaker: u32,
}

type Embedding = [f32; EMBEDDING];

/// Turns the samples of one window (16 kHz, scaled to -1..1) into a voice
/// print of unit length.
trait VoicePrint: Sync {
    /// What each thread keeps from one window to the next.
    type Worker;
    fn worker(&self) -> Self::Worker;
    fn embed(&self, worker: &mut Self::Worker, window: &[f32]) -> Result<Embedding, String>;
}

/// The CAM++ model, loaded and optimised once and shared by every thread.
struct Campplus(Arc<TypedRunnableModel>);

impl Campplus {
    /// The installed model, once its size and SHA-256 match the pin. A file
    /// that does not match is deleted, so the next attempt downloads it again.
    fn installed(path: &Path) -> Result<Self, String> {
        match model_download::read_verified(path, &SPEAKER_MODEL) {
            Ok(bytes) => Self::from_bytes(&bytes),
            Err(Unusable::Missing) => Err(MISSING.into()),
            Err(Unusable::Mismatch) => {
                let _ = fs::remove_file(path);
                Err(DAMAGED.into())
            }
            Err(Unusable::Unreadable(reason)) => {
                Err(format!("Cannot read the speaker model: {reason}"))
            }
        }
    }

    /// Parses bytes already checked against the pin. The model is read from
    /// memory, so the file cannot change between the check and the parse.
    fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        tract_onnx::onnx()
            .model_for_read(&mut &bytes[..])
            .and_then(|model| {
                model.with_input_fact(0, f32::fact([1, MODEL_FRAMES, fbank::BINS]).into())
            })
            .and_then(|model| model.into_optimized())
            .and_then(|model| model.into_runnable())
            .map(Self)
            .map_err(|e| format!("Cannot load the speaker model: {e}"))
    }
}

impl VoicePrint for Campplus {
    type Worker = Fbank;

    fn worker(&self) -> Fbank {
        Fbank::new()
    }

    fn embed(&self, fbank: &mut Fbank, window: &[f32]) -> Result<Embedding, String> {
        let input = model_input(&fbank.compute(window));
        let failed = |e: TractError| format!("The speaker model failed: {e}");
        let tensor = Tensor::from_shape(&[1, MODEL_FRAMES, fbank::BINS], &input).map_err(failed)?;
        let outputs = self.0.run(tvec!(tensor.into())).map_err(failed)?;
        let values = outputs[0].to_plain_array_view::<f32>().map_err(failed)?;
        if values.len() != EMBEDDING {
            return Err("The speaker model failed: unexpected output size".into());
        }
        let mut print = [0f32; EMBEDDING];
        for (slot, value) in print.iter_mut().zip(values.iter()) {
            *slot = *value;
        }
        normalize(&mut print);
        Ok(print)
    }
}

/// What the model reads for one window: its feature rows minus their mean
/// (the model was trained on mean-normalised features), repeated as needed
/// to fill the model's 150 rows.
fn model_input(rows: &[[f32; fbank::BINS]]) -> Vec<f32> {
    let mut mean = [0f32; fbank::BINS];
    for row in rows {
        for (sum, value) in mean.iter_mut().zip(row) {
            *sum += value;
        }
    }
    let count = rows.len().max(1) as f32;
    mean.iter_mut().for_each(|sum| *sum /= count);
    rows.iter()
        .cycle()
        .take(MODEL_FRAMES)
        .flat_map(|row| row.iter().zip(&mean).map(|(value, mean)| value - mean))
        .collect()
}

/// Scales a voice print to unit length. Anything that is not a number counts
/// as 0, so one odd window can never break the clustering.
fn normalize(print: &mut Embedding) {
    for value in print.iter_mut() {
        if !value.is_finite() {
            *value = 0.0;
        }
    }
    let norm = print.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 && norm.is_finite() {
        print.iter_mut().for_each(|value| *value /= norm);
    } else {
        *print = [0.0; EMBEDDING];
    }
}

fn dot(a: &Embedding, b: &Embedding) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

// ── Reading the recording ─────────────────────────────────────────────

/// Counts the bytes read through it, for the progress of the first pass.
struct Counted<'a, R> {
    inner: R,
    read: &'a Cell<u64>,
}

impl<R: Read> Read for Counted<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.inner.read(buffer)?;
        self.read.set(self.read.get() + count as u64);
        Ok(count)
    }
}

impl<R: Seek> Seek for Counted<'_, R> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.inner.seek(position)
    }
}

type Samples<'a> = Box<dyn Iterator<Item = Result<i16, String>> + 'a>;

/// A saved recording, WAV or Ogg Opus. The file stays open for the whole
/// run, so both passes read the same audio.
struct Recording {
    file: File,
    bytes: u64,
    compressed: bool,
}

impl Recording {
    fn open(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|_| compact_audio::GONE.to_string())?;
        let bytes = file.metadata().map(|m| m.len()).unwrap_or(0);
        let recording = Self {
            file,
            bytes,
            compressed: compact_audio::is_compressed(path),
        };
        // Audio the engine cannot read is refused before any work starts.
        drop(recording.samples(&Cell::new(0))?);
        Ok(recording)
    }

    /// The samples from the start, one at a time. `read` counts the bytes.
    fn samples<'a>(&self, read: &'a Cell<u64>) -> Result<Samples<'a>, String> {
        let unreadable = |e: io::Error| format!("Cannot read recording: {e}");
        let mut file = self.file.try_clone().map_err(unreadable)?;
        file.seek(SeekFrom::Start(0)).map_err(unreadable)?;
        let input = BufReader::new(Counted { inner: file, read });
        if self.compressed {
            return Ok(Box::new(compact_audio::Samples::open(input)?));
        }
        let reader = hound::WavReader::new(input).map_err(|e| format!("Invalid WAV audio: {e}"))?;
        let spec = reader.spec();
        if spec.channels != 1
            || spec.sample_rate != compact_audio::SAMPLE_RATE
            || spec.bits_per_sample != 16
            || spec.sample_format != hound::SampleFormat::Int
        {
            return Err("Local speech requires mono 16 kHz PCM audio.".into());
        }
        Ok(Box::new(reader.into_samples::<i16>().map(|sample| {
            sample.map_err(|e| format!("Invalid WAV audio: {e}"))
        })))
    }
}

/// First pass: the loudness of every 20 ms of the recording.
fn levels(
    samples: Samples<'_>,
    cancel: &AtomicBool,
    mut progress: impl FnMut(),
) -> Result<Vec<f32>, String> {
    let cancelled = || cancel.load(Ordering::Relaxed);
    let mut levels = Vec::new();
    // A second at a time: a whole number of 20 ms frames.
    let mut block = Vec::with_capacity(SAMPLE_RATE);
    for sample in samples {
        block.push(sample?);
        if block.len() == SAMPLE_RATE {
            levels.extend(streaming::frame_levels(&block));
            block.clear();
            if cancelled() {
                return Err(CANCELLED.into());
            }
            progress();
        }
    }
    if cancelled() {
        return Err(CANCELLED.into());
    }
    levels.extend(streaming::frame_levels(&block));
    Ok(levels)
}

/// Where the speech is, in samples: frames at least as loud as the live
/// chunker's pause level, with short pauses bridged and short blips dropped.
fn speech_regions(levels: &[f32]) -> Vec<(usize, usize)> {
    let loudest = levels.iter().copied().fold(0.0, f32::max);
    let quiet = streaming::quiet_level(loudest);
    let mut regions: Vec<(usize, usize)> = Vec::new();
    let mut frame = 0;
    while frame < levels.len() {
        if levels[frame] < quiet {
            frame += 1;
            continue;
        }
        let start = frame;
        while frame < levels.len() && levels[frame] >= quiet {
            frame += 1;
        }
        match regions.last_mut() {
            Some(last) if start - last.1 < BRIDGED_FRAMES => last.1 = frame,
            _ => regions.push((start, frame)),
        }
    }
    regions
        .into_iter()
        .filter(|(start, end)| end - start >= SHORTEST_SPEECH_FRAMES)
        .map(|(start, end)| (start * LEVEL_FRAME, end * LEVEL_FRAME))
        .collect()
}

/// What the voice prints listen to: 1.5 s every 0.75 s inside each stretch
/// of speech, the last one ending with it. A shorter stretch is one window.
fn windows(regions: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut windows = Vec::new();
    for &(start, end) in regions {
        if end - start <= WINDOW {
            windows.push((start, end));
            continue;
        }
        let mut at = start;
        while at + WINDOW < end {
            windows.push((at, at + WINDOW));
            at += HOP;
        }
        windows.push((end - WINDOW, end));
    }
    windows
}

/// Reads the recording once more and hands over the samples of each window
/// in turn, scaled to -1..1. Only what the next windows need is kept, and
/// the silence between them is skipped. `deliver` answers false to stop.
fn read_windows(
    mut samples: Samples<'_>,
    windows: &[(usize, usize)],
    mut deliver: impl FnMut(usize, Vec<f32>) -> Result<bool, String>,
) -> Result<(), String> {
    let mut kept = VecDeque::with_capacity(2 * WINDOW);
    // Where in the recording the first kept sample is.
    let mut first = 0;
    for (index, &(start, end)) in windows.iter().enumerate() {
        let stale = start.saturating_sub(first).min(kept.len());
        kept.drain(..stale);
        first += stale;
        while first + kept.len() < end {
            let Some(sample) = samples.next() else {
                return Err("Cannot read recording: it ended early.".into());
            };
            let sample = f32::from(sample?) / 32768.0;
            if kept.is_empty() && first < start {
                first += 1;
            } else {
                kept.push_back(sample);
            }
        }
        let window = kept.range(start - first..end - first).copied().collect();
        if !deliver(index, window)? {
            break;
        }
    }
    Ok(())
}

/// Second pass: the voice print of every window, worked out on `threads`
/// threads while this one reads the recording. `progress` hears how many
/// windows are done.
fn voice_prints<P: VoicePrint>(
    samples: Samples<'_>,
    windows: &[(usize, usize)],
    print: &P,
    threads: usize,
    cancel: &AtomicBool,
    mut progress: impl FnMut(usize),
) -> Result<Vec<Embedding>, String> {
    let mut prints = vec![[0f32; EMBEDDING]; windows.len()];
    let failed = AtomicBool::new(false);
    let stopped = || cancel.load(Ordering::Relaxed) || failed.load(Ordering::Relaxed);
    let mut error = None;
    let mut done = 0;
    let threads = threads.max(1);
    // A few windows wait for each thread: enough to keep it busy, and little
    // memory.
    let (jobs, queue) = mpsc::sync_channel::<(usize, Vec<f32>)>(threads * 2);
    let queue = Mutex::new(queue);
    let (results, finished) = mpsc::channel::<Result<(usize, Embedding), String>>();
    let read = std::thread::scope(|scope| {
        for _ in 0..threads {
            let (queue, results, stopped) = (&queue, results.clone(), &stopped);
            scope.spawn(move || {
                let mut worker = print.worker();
                loop {
                    let job = queue
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .recv();
                    let Ok((index, window)) = job else { break };
                    if stopped() {
                        continue;
                    }
                    // A failure in the model ends the run with an error,
                    // never with a thread that is gone and a reader that
                    // waits for it.
                    let result =
                        panic::catch_unwind(AssertUnwindSafe(|| print.embed(&mut worker, &window)))
                            .unwrap_or_else(|_| Err("The speaker model failed: it stopped".into()))
                            .map(|embedding| (index, embedding));
                    if results.send(result).is_err() {
                        break;
                    }
                }
            });
        }
        drop(results);
        let mut collect = |result: Result<(usize, Embedding), String>| match result {
            Ok((index, embedding)) => {
                prints[index] = embedding;
                done += 1;
                progress(done);
            }
            Err(reason) => {
                failed.store(true, Ordering::Relaxed);
                error.get_or_insert(reason);
            }
        };
        let read = read_windows(samples, windows, |index, window| {
            if stopped() {
                return Ok(false);
            }
            jobs.send((index, window))
                .map_err(|_| "The speaker model failed: it stopped".to_string())?;
            while let Ok(result) = finished.try_recv() {
                collect(result);
            }
            Ok(true)
        });
        drop(jobs);
        for result in finished {
            collect(result);
        }
        read
    });
    if cancel.load(Ordering::Relaxed) {
        return Err(CANCELLED.into());
    }
    if let Some(reason) = error {
        return Err(reason);
    }
    read?;
    Ok(prints)
}

// ── Grouping voice prints into speakers ───────────────────────────────

/// Which speaker each window is: 0, 1, 2… in no particular order.
/// `speakers` is the number the user asked for, if any.
fn cluster(
    prints: &[Embedding],
    windows: &[(usize, usize)],
    speakers: Option<usize>,
) -> Vec<usize> {
    let reliable: Vec<usize> = (0..windows.len())
        .filter(|&index| windows[index].1 - windows[index].0 >= RELIABLE)
        .collect();
    let step = reliable.len().div_ceil(MAX_CLUSTERED).max(1);
    let chosen: Vec<usize> = reliable.into_iter().step_by(step).collect();
    let count = chosen.len();
    if count < SMALLEST_GROUP {
        // Too little speech to tell voices apart.
        return vec![0; prints.len()];
    }
    let mut distances = Vec::with_capacity(count * (count - 1) / 2);
    for (position, &a) in chosen.iter().enumerate() {
        for &b in &chosen[position + 1..] {
            distances.push((1.0 - dot(&prints[a], &prints[b])).max(0.0));
        }
    }
    let tree = kodama::linkage(&mut distances, count, kodama::Method::Average);
    let smallest = ((count as f32 * SMALLEST_SHARE).ceil() as usize).max(SMALLEST_GROUP);
    let groups = match speakers {
        None => cut(&tree, count, count - 1, Some(AUTO_DISTANCE)),
        Some(wanted) => {
            // Groups too small to be a speaker do not count, so the tree is
            // cut a little lower until enough groups are big.
            let mut extra = 0;
            loop {
                let groups = cut(&tree, count, count.saturating_sub(wanted + extra), None);
                if big_groups(&groups, smallest).len() >= wanted || extra > 8 {
                    break groups;
                }
                extra += 1;
            }
        }
    };
    let mut kept = big_groups(&groups, smallest);
    if kept.is_empty() {
        kept = big_groups(&groups, 0);
        kept.truncate(1);
    }
    if let Some(wanted) = speakers {
        kept.truncate(wanted);
    }
    let centres: Vec<Embedding> = kept
        .iter()
        .map(|&group| {
            let mut centre = [0f32; EMBEDDING];
            for (position, _) in groups.iter().enumerate().filter(|(_, g)| **g == group) {
                for (sum, value) in centre.iter_mut().zip(&prints[chosen[position]]) {
                    *sum += value;
                }
            }
            normalize(&mut centre);
            centre
        })
        .collect();
    prints
        .iter()
        .map(|print| {
            (0..centres.len())
                .max_by(|a, b| dot(print, &centres[*a]).total_cmp(&dot(print, &centres[*b])))
                .unwrap_or(0)
        })
        .collect()
}

/// The group of each clustered window after the first `merges` merges of
/// the tree, stopping early at a merge further apart than `limit`. Groups
/// are numbered in the order their first window comes.
fn cut(
    tree: &kodama::Dendrogram<f32>,
    count: usize,
    merges: usize,
    limit: Option<f32>,
) -> Vec<usize> {
    fn root(parent: &mut [usize], mut node: usize) -> usize {
        while parent[node] != node {
            parent[node] = parent[parent[node]];
            node = parent[node];
        }
        node
    }
    // Kodama labels the group made by step i as `count + i`.
    let mut parent: Vec<usize> = (0..2 * count).collect();
    for (step, merge) in tree.steps().iter().enumerate().take(merges) {
        if limit.is_some_and(|limit| merge.dissimilarity > limit) {
            break;
        }
        let (a, b) = (
            root(&mut parent, merge.cluster1),
            root(&mut parent, merge.cluster2),
        );
        parent[a] = count + step;
        parent[b] = count + step;
    }
    let mut numbers = vec![usize::MAX; 2 * count];
    let mut next = 0;
    (0..count)
        .map(|window| {
            let group = root(&mut parent, window);
            if numbers[group] == usize::MAX {
                numbers[group] = next;
                next += 1;
            }
            numbers[group]
        })
        .collect()
}

/// The groups with at least `smallest` windows, largest first.
fn big_groups(groups: &[usize], smallest: usize) -> Vec<usize> {
    let count = groups.iter().max().map_or(0, |last| last + 1);
    let mut sizes: Vec<(usize, usize)> = (0..count)
        .map(|group| (groups.iter().filter(|g| **g == group).count(), group))
        .filter(|(size, _)| *size >= smallest.max(1))
        .collect();
    // Largest first; between equals, the group heard first.
    sizes.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    sizes.into_iter().map(|(_, group)| group).collect()
}

/// A stretch of speech, in samples, and its speaker.
type Turn = (usize, usize, usize);

/// Each 10 ms of speech takes the speaker of the nearest window centre, and
/// runs of one speaker become turns.
fn turns(regions: &[(usize, usize)], windows: &[(usize, usize)], speakers: &[usize]) -> Vec<Turn> {
    let centres: Vec<usize> = windows
        .iter()
        .map(|(start, end)| (start + end) / 2)
        .collect();
    let mut turns: Vec<Turn> = Vec::new();
    if centres.is_empty() {
        return turns;
    }
    let mut nearest = 0;
    for &(start, end) in regions {
        let mut at = start;
        while at < end {
            while nearest + 1 < centres.len()
                && centres[nearest + 1].abs_diff(at) <= centres[nearest].abs_diff(at)
            {
                nearest += 1;
            }
            let speaker = speakers[nearest];
            let next = (at + fbank::SHIFT).min(end);
            match turns.last_mut() {
                Some(last) if last.1 == at && last.2 == speaker => last.1 = next,
                _ => turns.push((at, next, speaker)),
            }
            at = next;
        }
    }
    turns
}

/// A turn shorter than half a second that runs straight into another
/// speaker's turn is given to the longer of the two around it. A short turn
/// with a pause on both sides is a reply of its own and stays.
fn smooth(turns: &mut Vec<Turn>) {
    fn touches(turns: &[Turn], a: usize, b: usize) -> bool {
        turns[a].1 == turns[b].0
    }
    loop {
        let length = |turn: &Turn| turn.1 - turn.0;
        let neighbours = |index: usize| {
            let before = (index > 0 && touches(turns, index - 1, index)).then(|| index - 1);
            let after =
                (index + 1 < turns.len() && touches(turns, index, index + 1)).then_some(index + 1);
            (before, after)
        };
        let shortest = (0..turns.len())
            .filter(|&index| length(&turns[index]) < SHORTEST_TURN)
            .filter(|&index| neighbours(index) != (None, None))
            .min_by_key(|&index| (length(&turns[index]), index));
        let Some(index) = shortest else { break };
        let into = match neighbours(index) {
            (Some(before), Some(after)) if length(&turns[after]) > length(&turns[before]) => after,
            (Some(before), _) => before,
            (None, Some(after)) => after,
            (None, None) => break,
        };
        turns[index].2 = turns[into].2;
        // Join it to the neighbours it now shares a speaker with.
        turns.dedup_by(|next, previous| {
            let joined = previous.1 == next.0 && previous.2 == next.2;
            if joined {
                previous.1 = next.1;
            }
            joined
        });
    }
}

/// Turns in milliseconds, with speakers numbered 1, 2, 3… as they are first
/// heard.
fn numbered(turns: &[Turn]) -> Vec<SpeakerTurn> {
    let ms = |sample: usize| (sample as u64 * 1000 + SAMPLE_RATE as u64 / 2) / SAMPLE_RATE as u64;
    let mut heard: Vec<usize> = Vec::new();
    turns
        .iter()
        .map(|&(start, end, speaker)| {
            let number = match heard.iter().position(|known| *known == speaker) {
                Some(position) => position,
                None => {
                    heard.push(speaker);
                    heard.len() - 1
                }
            };
            SpeakerTurn {
                start_ms: ms(start),
                end_ms: ms(end),
                speaker: number as u32 + 1,
            }
        })
        .collect()
}

fn threads() -> usize {
    std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1)
        .clamp(1, MAX_THREADS)
}

/// Who speaks when in `recording`. `report` hears the percentage done.
fn detect<P: VoicePrint>(
    recording: &Recording,
    print: &P,
    speakers: Option<usize>,
    threads: usize,
    cancel: &AtomicBool,
    report: &mut dyn FnMut(u32),
) -> Result<Vec<SpeakerTurn>, String> {
    let mut last = None;
    let mut progress = |percent: u64| {
        let percent = percent.min(100) as u32;
        if last != Some(percent) {
            last = Some(percent);
            report(percent);
        }
    };
    progress(0);
    let read = Cell::new(0);
    let bytes = recording.bytes.max(1);
    let levels = levels(recording.samples(&read)?, cancel, || {
        progress(read.get().min(bytes) * FIRST_PASS_PERCENT / bytes)
    })?;
    let regions = speech_regions(&levels);
    drop(levels);
    let windows = windows(&regions);
    if windows.is_empty() {
        progress(100);
        return Ok(Vec::new());
    }
    let total = windows.len() as u64;
    let prints = voice_prints(
        recording.samples(&Cell::new(0))?,
        &windows,
        print,
        threads,
        cancel,
        |done| {
            progress(FIRST_PASS_PERCENT + done as u64 * (99 - FIRST_PASS_PERCENT) / total);
        },
    )?;
    let turns = speaker_turns(&regions, &windows, &prints, speakers, cancel)?;
    progress(100);
    Ok(turns)
}

/// Groups the voice prints into speakers, and the speech into their turns.
/// Grouping the prints of a long recording takes a while after the last
/// window, so a cancel that comes meanwhile still wins: it returns an error,
/// never turns.
fn speaker_turns(
    regions: &[(usize, usize)],
    windows: &[(usize, usize)],
    prints: &[Embedding],
    speakers: Option<usize>,
    cancel: &AtomicBool,
) -> Result<Vec<SpeakerTurn>, String> {
    let cancelled = || cancel.load(Ordering::Relaxed);
    let labels = cluster(prints, windows, speakers);
    if cancelled() {
        return Err(CANCELLED.into());
    }
    let mut turns = turns(regions, windows, &labels);
    smooth(&mut turns);
    if cancelled() {
        return Err(CANCELLED.into());
    }
    Ok(numbered(&turns))
}

/// Detects the speakers of the saved recording `id`. The recording is held
/// for the whole run, so it is not compressed while it is read; the model is
/// loaded once the audio is known to be there.
fn detect_saved<P: VoicePrint>(
    directory: &Path,
    id: &str,
    load: impl FnOnce() -> Result<P, String>,
    speakers: Option<usize>,
    cancel: &AtomicBool,
    report: &mut dyn FnMut(u32),
) -> Result<Vec<SpeakerTurn>, String> {
    let _hold = compact_audio::hold(id);
    let path = compact_audio::audio_file(directory, id).ok_or(compact_audio::GONE)?;
    let recording = Recording::open(&path)?;
    let print = load()?;
    detect(&recording, &print, speakers, threads(), cancel, report)
}

fn speaker_count(speakers: Option<u8>) -> Result<Option<usize>, String> {
    match speakers {
        None => Ok(None),
        Some(count @ 2..=8) => Ok(Some(usize::from(count))),
        Some(_) => Err(COUNT.into()),
    }
}

// ── Commands ──────────────────────────────────────────────────────────

/// One detection at a time: each one already uses every thread it may.
static RUNNING: Mutex<()> = Mutex::new(());
/// Set by `cancel_speaker_detection` and cleared when a run begins. A run
/// checks it every second of the first pass, before every window and after
/// grouping the voice prints. A cancel that comes before the run begins is
/// cleared with it, so the interface sends it again on the run's next
/// progress event.
static CANCEL: AtomicBool = AtomicBool::new(false);

fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join(MODEL_FILE))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerModelStatus {
    /// The model is on this device. Its hash is checked when it is loaded.
    ready: bool,
    /// What the download weighs.
    size_bytes: u64,
}

#[tauri::command]
pub fn speaker_model_status(app: tauri::AppHandle) -> Result<SpeakerModelStatus, String> {
    let size = fs::metadata(model_path(&app)?)
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len());
    Ok(SpeakerModelStatus {
        ready: size == Some(SPEAKER_MODEL.size),
        size_bytes: SPEAKER_MODEL.size,
    })
}

/// Downloads the speaker model, only when the user asks. Only the model is
/// requested; no audio or transcript is sent.
#[tauri::command]
pub async fn download_speaker_model(app: tauri::AppHandle) -> Result<SpeakerModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = model_path(&app)?;
        model_download::download_verified(&app, &SPEAKER_MODEL, &path, "speaker-model-progress")?;
        speaker_model_status(app)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Who speaks when in a saved recording, as turns. `speakers` is how many
/// there are, when the user knows (2 to 8); otherwise they are counted. The
/// percentage done is announced with `speaker-progress` events.
#[tauri::command]
pub async fn detect_speakers(
    app: tauri::AppHandle,
    id: String,
    speakers: Option<u8>,
) -> Result<Vec<SpeakerTurn>, String> {
    local_history::valid_id(&id)?;
    let speakers = speaker_count(speakers)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _one_at_a_time = match RUNNING.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return Err(BUSY.to_string()),
        };
        CANCEL.store(false, Ordering::SeqCst);
        if streaming::live_id().as_deref() == Some(id.as_str()) {
            return Err(STILL_RECORDING.into());
        }
        let directory = local_history::directory(&app)?;
        let model = model_path(&app)?;
        detect_saved(
            &directory,
            &id,
            || Campplus::installed(&model),
            speakers,
            &CANCEL,
            &mut |percent| {
                let _ = app.emit("speaker-progress", percent);
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the detection that is running at its next check, and makes it fail
/// with `CANCELLED` instead of returning turns.
#[tauri::command]
pub fn cancel_speaker_detection() {
    CANCEL.store(true, Ordering::SeqCst);
}

const USAGE: &str = "Usage: --detect-speakers audio.wav|audio.opus model.onnx [speakers, 2 to 8]";

/// The `--detect-speakers` diagnostic: the speaker turns of a 16 kHz mono
/// WAV or Ogg Opus file, as JSON. The model file must be the pinned one; it
/// is never deleted from here.
pub fn cli(args: &[String]) -> Result<String, String> {
    let (audio, model, count) = match args {
        [audio, model] => (audio, model, None),
        [audio, model, count] => (audio, model, Some(count.parse::<u8>().map_err(|_| COUNT)?)),
        _ => return Err(USAGE.into()),
    };
    let speakers = speaker_count(count)?;
    let recording = Recording::open(Path::new(audio))?;
    let print = match model_download::read_verified(Path::new(model), &SPEAKER_MODEL) {
        Ok(bytes) => Campplus::from_bytes(&bytes)?,
        Err(Unusable::Unreadable(reason)) => {
            return Err(format!("Cannot read the speaker model: {reason}"))
        }
        Err(_) => {
            return Err(format!(
                "{model} is not the speaker model this app expects (SHA-256 {}).",
                SPEAKER_MODEL.sha256
            ))
        }
    };
    let turns = detect(
        &recording,
        &print,
        speakers,
        threads(),
        &AtomicBool::new(false),
        &mut |_| {},
    )?;
    serde_json::to_string(&turns).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    const RATE: f32 = SAMPLE_RATE as f32;

    /// A steady tone with a syllable-like swell: loud enough to be speech.
    fn voice(seconds: f32, pitch: f32) -> Vec<i16> {
        (0..(seconds * RATE) as usize)
            .map(|i| {
                let t = i as f32 / RATE;
                let swell = 0.75 + 0.25 * (t * 4.0 * std::f32::consts::TAU).sin();
                ((t * pitch * std::f32::consts::TAU).sin() * swell * 9000.0) as i16
            })
            .collect()
    }

    fn silence(seconds: f32) -> Vec<i16> {
        vec![0; (seconds * RATE) as usize]
    }

    fn seconds(samples: usize) -> f32 {
        samples as f32 / RATE
    }

    fn saved(folder: &Path, id: &str, audio: &[i16]) -> PathBuf {
        let path = folder.join(format!("{id}.wav"));
        fs::write(&path, streaming::wav_bytes(audio)).unwrap();
        path
    }

    /// Stands in for the model: the voice print of a window is its pitch,
    /// as one of a few fixed directions, so each tone is one "speaker".
    #[derive(Default)]
    struct ByPitch {
        calls: AtomicUsize,
    }

    impl VoicePrint for ByPitch {
        type Worker = ();

        fn worker(&self) {}

        fn embed(&self, _: &mut (), window: &[f32]) -> Result<Embedding, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let crossings = window
                .windows(2)
                .filter(|pair| (pair[0] < 0.0) != (pair[1] < 0.0))
                .count();
            let pitch = crossings as f32 * RATE / window.len() as f32 / 2.0;
            let mut print = [0f32; EMBEDDING];
            print[(pitch / 100.0).round() as usize % EMBEDDING] = 1.0;
            Ok(print)
        }
    }

    /// A small seeded generator, so the clustering tests are repeatable.
    struct Seeded(u64);

    impl Seeded {
        fn next(&mut self) -> f32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 40) as f32 / (1u64 << 24) as f32 * 2.0 - 1.0
        }

        fn direction(&mut self) -> Embedding {
            let mut print = [0f32; EMBEDDING];
            print.iter_mut().for_each(|value| *value = self.next());
            normalize(&mut print);
            print
        }

        /// A print close to `centre`, as one window of that voice would be.
        fn near(&mut self, centre: &Embedding, spread: f32) -> Embedding {
            let mut print = *centre;
            print
                .iter_mut()
                .for_each(|value| *value += self.next() * spread);
            normalize(&mut print);
            print
        }
    }

    /// Full-length windows for `prints`, one after another.
    fn full_windows(count: usize) -> Vec<(usize, usize)> {
        (0..count).map(|i| (i * WINDOW, (i + 1) * WINDOW)).collect()
    }

    fn speakers_in(labels: &[usize]) -> usize {
        let mut seen = labels.to_vec();
        seen.sort_unstable();
        seen.dedup();
        seen.len()
    }

    #[test]
    fn finds_speech_between_pauses() {
        let mut audio = voice(1.0, 220.0);
        audio.extend(silence(1.0));
        audio.extend(voice(2.0, 220.0));
        // A pause under 300 ms does not end the speech...
        audio.extend(silence(0.2));
        audio.extend(voice(1.0, 220.0));
        audio.extend(silence(1.0));
        // ...and a blip under 200 ms is not speech.
        audio.extend(voice(0.1, 220.0));
        audio.extend(silence(1.0));
        let levels = streaming::frame_levels(&audio);
        let regions = speech_regions(&levels);
        assert_eq!(regions.len(), 2, "{regions:?}");
        let (first, second) = (regions[0], regions[1]);
        assert!(seconds(first.0) < 0.05 && (seconds(first.1) - 1.0).abs() < 0.05);
        assert!((seconds(second.0) - 2.0).abs() < 0.05);
        assert!((seconds(second.1) - 5.2).abs() < 0.05, "{second:?}");
        // Boundaries fall on 20 ms frames.
        assert!(regions
            .iter()
            .all(|(s, e)| s % LEVEL_FRAME == 0 && e % LEVEL_FRAME == 0));
        // Silence has no speech at all.
        assert!(speech_regions(&streaming::frame_levels(&silence(3.0))).is_empty());
    }

    #[test]
    fn cuts_speech_into_overlapping_windows() {
        let regions = [(0, 4 * SAMPLE_RATE), (5 * SAMPLE_RATE, 6 * SAMPLE_RATE)];
        let found = windows(&regions);
        let second = SAMPLE_RATE;
        assert_eq!(
            found,
            vec![
                (0, WINDOW),
                (HOP, HOP + WINDOW),
                (2 * HOP, 2 * HOP + WINDOW),
                (3 * HOP, 3 * HOP + WINDOW),
                // The last one ends with the speech.
                (4 * second - WINDOW, 4 * second),
                // A second of speech is one shorter window.
                (5 * second, 6 * second),
            ]
        );
        assert_eq!((WINDOW, HOP), (24_000, 12_000));
    }

    #[test]
    fn a_short_window_is_repeated_to_the_model_length() {
        let rows: Vec<[f32; fbank::BINS]> =
            (0..60).map(|frame| [frame as f32; fbank::BINS]).collect();
        let input = model_input(&rows);
        assert_eq!(input.len(), MODEL_FRAMES * fbank::BINS);
        // The mean of the 60 rows is removed, then the rows repeat.
        let mean = 59.0 / 2.0;
        for frame in [0, 59, 60, 61, 149] {
            assert_eq!(input[frame * fbank::BINS], (frame % 60) as f32 - mean);
        }
        // A full window is used as it is.
        let full: Vec<[f32; fbank::BINS]> = vec![[1.0; fbank::BINS]; MODEL_FRAMES];
        assert!(model_input(&full).iter().all(|value| *value == 0.0));
        // Every window of the shortest speech still has whole frames.
        assert_eq!(
            Fbank::frames(SHORTEST_SPEECH_FRAMES * LEVEL_FRAME),
            20,
            "200 ms of speech"
        );
        assert_eq!(Fbank::frames(WINDOW), MODEL_FRAMES);
    }

    #[test]
    fn hands_over_each_window_reading_the_audio_once() {
        let audio: Vec<i16> = (0..10 * SAMPLE_RATE).map(|i| (i % 30_000) as i16).collect();
        let windows = [
            (1_000, 25_000),
            (13_000, 37_000),
            (36_000, 40_000),
            (90_000, 114_000),
        ];
        let mut seen = vec![];
        read_windows(
            Box::new(audio.iter().map(|s| Ok(*s))),
            &windows,
            |index, window| {
                let (start, end) = windows[index];
                let expected: Vec<f32> = audio[start..end]
                    .iter()
                    .map(|s| f32::from(*s) / 32768.0)
                    .collect();
                assert_eq!(window, expected, "window {index}");
                seen.push(index);
                Ok(true)
            },
        )
        .unwrap();
        assert_eq!(seen, [0, 1, 2, 3]);
        // Audio that ends before the last window is an error.
        let short: Vec<i16> = audio[..100_000].to_vec();
        assert!(
            read_windows(Box::new(short.into_iter().map(Ok)), &windows, |_, _| Ok(
                true
            ))
            .is_err()
        );
        // Stopping early reads no further.
        let mut count = 0;
        read_windows(Box::new(audio.iter().map(|s| Ok(*s))), &windows, |_, _| {
            count += 1;
            Ok(count < 2)
        })
        .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn three_voices_are_three_speakers() {
        let mut random = Seeded(0x5eed);
        let centres: Vec<Embedding> = (0..3).map(|_| random.direction()).collect();
        let truth: Vec<usize> = (0..120).map(|i| (i / 10) % 3).collect();
        let prints: Vec<Embedding> = truth
            .iter()
            .map(|speaker| random.near(&centres[*speaker], 0.05))
            .collect();
        let windows = full_windows(prints.len());
        let labels = cluster(&prints, &windows, None);
        assert_eq!(speakers_in(&labels), 3);
        // The same voice is always the same speaker.
        for (label, speaker) in labels.iter().zip(&truth) {
            assert_eq!(
                *label,
                labels[truth.iter().position(|s| s == speaker).unwrap()]
            );
        }
        // Asked for two, the closest voices share a speaker.
        let two = cluster(&prints, &windows, Some(2));
        assert_eq!(speakers_in(&two), 2);
        // Asked for more speakers than there are voices, it finds the voices.
        assert_eq!(speakers_in(&cluster(&prints, &windows, Some(5))), 3);
    }

    #[test]
    fn a_handful_of_odd_windows_is_not_a_speaker() {
        let mut random = Seeded(42);
        let centres: Vec<Embedding> = (0..4).map(|_| random.direction()).collect();
        // Three voices of 100 windows each, and 3 windows (1%) of a fourth.
        let mut truth: Vec<usize> = (0..300).map(|i| (i / 25) % 3).collect();
        for at in [50, 150, 250] {
            truth.insert(at, 3);
        }
        let prints: Vec<Embedding> = truth
            .iter()
            .map(|speaker| random.near(&centres[*speaker], 0.05))
            .collect();
        let labels = cluster(&prints, &full_windows(prints.len()), None);
        assert_eq!(speakers_in(&labels), 3);
    }

    #[test]
    fn too_little_speech_is_one_speaker() {
        let mut random = Seeded(7);
        let prints: Vec<Embedding> = (0..3).map(|_| random.direction()).collect();
        assert_eq!(cluster(&prints, &full_windows(3), None), vec![0, 0, 0]);
        // Short windows are not reliable enough to count.
        let prints: Vec<Embedding> = (0..20).map(|_| random.direction()).collect();
        let short: Vec<(usize, usize)> = (0..20).map(|i| (i * WINDOW, i * WINDOW + 8000)).collect();
        assert_eq!(cluster(&prints, &short, None), vec![0; 20]);
        assert_eq!(cluster(&prints, &short, Some(3)), vec![0; 20]);
    }

    #[test]
    fn frame_labels_become_turns_in_milliseconds() {
        // One stretch of speech with windows of two speakers, then a reply.
        let regions = [(0, 48_000), (64_000, 72_000)];
        let windows = [
            (0, 24_000),
            (12_000, 36_000),
            (24_000, 48_000),
            (64_000, 72_000),
        ];
        let turns = turns(&regions, &windows, &[4, 4, 9, 4]);
        // The label changes halfway between window centres (1.5 s and 2.25 s).
        assert_eq!(
            turns,
            vec![(0, 30_080, 4), (30_080, 48_000, 9), (64_000, 72_000, 4)]
        );
        assert_eq!(
            numbered(&turns),
            vec![
                SpeakerTurn {
                    start_ms: 0,
                    end_ms: 1880,
                    speaker: 1
                },
                SpeakerTurn {
                    start_ms: 1880,
                    end_ms: 3000,
                    speaker: 2
                },
                SpeakerTurn {
                    start_ms: 4000,
                    end_ms: 4500,
                    speaker: 1
                },
            ]
        );
        // Sample positions are rounded to the nearest millisecond.
        let odd = numbered(&[(7, 24, 0)]);
        assert_eq!((odd[0].start_ms, odd[0].end_ms), (0, 2));
    }

    #[test]
    fn a_flicker_joins_the_turn_around_it() {
        let ms = |ms: usize| ms * SAMPLE_RATE / 1000;
        let mut flicker = vec![
            (ms(0), ms(3000), 0),
            (ms(3000), ms(3300), 1),
            (ms(3300), ms(5000), 0),
            // A short reply after a pause is a turn of its own.
            (ms(5600), ms(5900), 1),
            (ms(6500), ms(9000), 0),
            // A short turn between two others goes to the longer one.
            (ms(9000), ms(9400), 2),
            (ms(9400), ms(12_000), 1),
        ];
        smooth(&mut flicker);
        assert_eq!(
            flicker,
            vec![
                (ms(0), ms(5000), 0),
                (ms(5600), ms(5900), 1),
                (ms(6500), ms(9000), 0),
                (ms(9000), ms(12_000), 1),
            ]
        );
        // Speakers are numbered in the order they are first heard.
        let numbers: Vec<u32> = numbered(&flicker).iter().map(|turn| turn.speaker).collect();
        assert_eq!(numbers, [1, 2, 1, 2]);
    }

    /// Two "voices", each turn followed by a pause, as a WAV of `turns`
    /// turns: 1.6 to 2.8 s long, alternating 200 Hz and 600 Hz.
    fn dialogue(turns: usize) -> (Vec<i16>, Vec<(f32, f32, usize)>) {
        let mut audio = silence(0.5);
        let mut truth = vec![];
        for turn in 0..turns {
            let speaker = turn % 2;
            let length = 1.6 + (turn % 5) as f32 * 0.3;
            let start = seconds(audio.len());
            audio.extend(voice(length, if speaker == 0 { 200.0 } else { 600.0 }));
            truth.push((start, start + length, speaker));
            audio.extend(silence(0.6));
        }
        (audio, truth)
    }

    #[test]
    fn detects_who_speaks_when_in_a_saved_recording() {
        let folder = tempfile::tempdir().unwrap();
        let (audio, truth) = dialogue(12);
        saved(folder.path(), "880-1", &audio);
        let print = ByPitch::default();
        let mut seen = vec![];
        let turns = detect_saved(
            folder.path(),
            "880-1",
            || Ok(&print),
            None,
            &AtomicBool::new(false),
            &mut |percent| seen.push(percent),
        )
        .unwrap();
        assert_eq!(turns.len(), truth.len(), "{turns:?}");
        for (turn, (start, end, speaker)) in turns.iter().zip(&truth) {
            assert_eq!(turn.speaker, *speaker as u32 + 1);
            assert!(
                (turn.start_ms as f32 / 1000.0 - start).abs() < 0.05,
                "{turn:?}"
            );
            assert!((turn.end_ms as f32 / 1000.0 - end).abs() < 0.05, "{turn:?}");
        }
        // Progress rises from 0 to 100.
        assert_eq!((seen[0], *seen.last().unwrap()), (0, 100));
        assert!(seen.windows(2).all(|pair| pair[0] < pair[1]), "{seen:?}");
        // Every window was listened to once.
        assert_eq!(
            print.calls.load(Ordering::SeqCst),
            windows(&speech_regions(&streaming::frame_levels(&audio))).len()
        );
    }

    #[test]
    fn a_compressed_recording_gives_the_same_turns() {
        let folder = tempfile::tempdir().unwrap();
        let (audio, _) = dialogue(8);
        saved(folder.path(), "882-1", &audio);
        let run = || {
            detect_saved(
                folder.path(),
                "882-1",
                || Ok(ByPitch::default()),
                Some(2),
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .unwrap()
        };
        let from_wav = run();
        assert!(compact_audio::compress(folder.path(), "882-1").unwrap() > 0);
        let from_opus = run();
        assert_eq!(from_opus.len(), from_wav.len());
        for (a, b) in from_opus.iter().zip(&from_wav) {
            assert_eq!(a.speaker, b.speaker);
            assert!(a.start_ms.abs_diff(b.start_ms) <= 40 && a.end_ms.abs_diff(b.end_ms) <= 40);
        }
    }

    #[test]
    fn silence_has_no_speakers_and_missing_audio_is_reported() {
        let folder = tempfile::tempdir().unwrap();
        saved(folder.path(), "883-1", &silence(5.0));
        let run = |id: &str| {
            detect_saved(
                folder.path(),
                id,
                || Ok(ByPitch::default()),
                None,
                &AtomicBool::new(false),
                &mut |_| {},
            )
        };
        assert_eq!(run("883-1"), Ok(vec![]));
        assert_eq!(run("884-1").unwrap_err(), compact_audio::GONE);
        fs::write(folder.path().join("885-1.wav"), b"RIFF").unwrap();
        assert!(run("885-1").unwrap_err().starts_with("Invalid WAV audio"));
    }

    #[test]
    fn cancelling_stops_between_windows() {
        struct Cancels<'a> {
            calls: AtomicUsize,
            cancel: &'a AtomicBool,
        }
        impl VoicePrint for Cancels<'_> {
            type Worker = ();
            fn worker(&self) {}
            fn embed(&self, _: &mut (), _: &[f32]) -> Result<Embedding, String> {
                if self.calls.fetch_add(1, Ordering::SeqCst) == 2 {
                    self.cancel.store(true, Ordering::SeqCst);
                }
                Ok([0.1; EMBEDDING])
            }
        }
        let folder = tempfile::tempdir().unwrap();
        let (audio, _) = dialogue(20);
        let path = saved(folder.path(), "886-1", &audio);
        let total = windows(&speech_regions(&streaming::frame_levels(&audio))).len();
        let cancel = AtomicBool::new(false);
        let print = Cancels {
            calls: AtomicUsize::new(0),
            cancel: &cancel,
        };
        let recording = Recording::open(&path).unwrap();
        let result = detect(&recording, &print, None, 1, &cancel, &mut |_| {});
        assert_eq!(result.unwrap_err(), CANCELLED);
        let calls = print.calls.load(Ordering::SeqCst);
        // The windows already queued are skipped too.
        assert!(calls <= 3 + 2, "{calls} of {total} windows");
        // Cancelled before it starts, nothing is listened to.
        let print = ByPitch::default();
        let result = detect(
            &recording,
            &print,
            None,
            2,
            &AtomicBool::new(true),
            &mut |_| {},
        );
        assert_eq!(result.unwrap_err(), CANCELLED);
        assert_eq!(print.calls.load(Ordering::SeqCst), 0);
        // Even a recording shorter than a second.
        let short = Box::new(voice(0.5, 220.0).into_iter().map(Ok));
        assert_eq!(
            levels(short, &AtomicBool::new(true), || {}).unwrap_err(),
            CANCELLED
        );
    }

    #[test]
    fn a_cancel_while_grouping_returns_no_turns() {
        let (audio, _) = dialogue(6);
        let regions = speech_regions(&streaming::frame_levels(&audio));
        let windows = windows(&regions);
        let print = ByPitch::default();
        let prints: Vec<Embedding> = windows
            .iter()
            .map(|&(start, end)| {
                let window: Vec<f32> = audio[start..end]
                    .iter()
                    .map(|sample| f32::from(*sample) / 32768.0)
                    .collect();
                print.embed(&mut (), &window).unwrap()
            })
            .collect();
        let group = |cancel: bool| {
            speaker_turns(&regions, &windows, &prints, None, &AtomicBool::new(cancel))
        };
        assert_eq!(group(false).unwrap().len(), 6);
        // Cancelled after the last window, while the prints are grouped:
        // the turns are thrown away.
        assert_eq!(group(true).unwrap_err(), CANCELLED);
    }

    #[test]
    fn a_failing_model_ends_the_run_with_its_error() {
        struct Fails;
        impl VoicePrint for Fails {
            type Worker = ();
            fn worker(&self) {}
            fn embed(&self, _: &mut (), _: &[f32]) -> Result<Embedding, String> {
                Err("The speaker model failed: test".into())
            }
        }
        struct Panics;
        impl VoicePrint for Panics {
            type Worker = ();
            fn worker(&self) {}
            fn embed(&self, _: &mut (), _: &[f32]) -> Result<Embedding, String> {
                panic!("a bug in the model runtime")
            }
        }
        let folder = tempfile::tempdir().unwrap();
        let path = saved(folder.path(), "887-1", &dialogue(10).0);
        let recording = Recording::open(&path).unwrap();
        let never = AtomicBool::new(false);
        assert_eq!(
            detect(&recording, &Fails, None, 3, &never, &mut |_| {}).unwrap_err(),
            "The speaker model failed: test"
        );
        assert!(detect(&recording, &Panics, None, 3, &never, &mut |_| {})
            .unwrap_err()
            .starts_with("The speaker model failed"));
    }

    #[test]
    fn the_recording_is_not_compressed_while_it_is_read() {
        /// Tries to compress every recording while the first window is
        /// worked on, and remembers what that did.
        struct Compresses<'a> {
            folder: &'a Path,
            during: Mutex<Option<compact_audio::Compressed>>,
        }
        impl VoicePrint for Compresses<'_> {
            type Worker = ();
            fn worker(&self) {}
            fn embed(&self, _: &mut (), window: &[f32]) -> Result<Embedding, String> {
                let mut during = self.during.lock().unwrap();
                if during.is_none() {
                    *during = Some(compact_audio::compress_all(self.folder).unwrap());
                }
                ByPitch::default().embed(&mut (), window)
            }
        }
        let folder = tempfile::tempdir().unwrap();
        saved(folder.path(), "888-1", &dialogue(6).0);
        let print = Compresses {
            folder: folder.path(),
            during: Mutex::new(None),
        };
        let turns = detect_saved(
            folder.path(),
            "888-1",
            || Ok(&print),
            None,
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(turns.len(), 6);
        let during = print.during.lock().unwrap().take().unwrap();
        assert_eq!((during.recordings, during.failed), (0, 0));
        // Once detection is over, the recording is compressed like any other.
        assert_eq!(
            compact_audio::compress_all(folder.path())
                .unwrap()
                .recordings,
            1
        );
        assert!(folder.path().join("888-1.opus").exists());
    }

    #[test]
    fn the_speaker_count_must_be_between_two_and_eight() {
        assert_eq!(speaker_count(None), Ok(None));
        assert_eq!(speaker_count(Some(2)), Ok(Some(2)));
        assert_eq!(speaker_count(Some(8)), Ok(Some(8)));
        for wrong in [0, 1, 9, 255] {
            assert_eq!(speaker_count(Some(wrong)).unwrap_err(), COUNT);
        }
        let usage = |args: &[&str]| cli(&args.iter().map(|a| a.to_string()).collect::<Vec<_>>());
        assert_eq!(usage(&[]).unwrap_err(), USAGE);
        assert_eq!(usage(&["a.wav", "m.onnx", "9"]).unwrap_err(), COUNT);
        assert_eq!(usage(&["a.wav", "m.onnx", "two"]).unwrap_err(), COUNT);
    }

    #[test]
    fn a_wrong_model_file_is_never_parsed() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join(MODEL_FILE);
        assert_eq!(Campplus::installed(&path).err().unwrap(), MISSING);
        // The right size but not the right bytes: deleted, to be downloaded again.
        let file = File::create(&path).unwrap();
        file.set_len(SPEAKER_MODEL.size).unwrap();
        drop(file);
        assert_eq!(Campplus::installed(&path).err().unwrap(), DAMAGED);
        assert!(!path.exists());
        // The command-line check never deletes the file it is given.
        fs::write(&path, b"not a model").unwrap();
        let audio = saved(folder.path(), "889-1", &dialogue(2).0);
        let args = [
            audio.to_string_lossy().into_owned(),
            path.to_string_lossy().into_owned(),
        ];
        assert!(cli(&args).unwrap_err().contains("is not the speaker model"));
        assert!(path.exists());
    }

    impl<P: VoicePrint> VoicePrint for &P {
        type Worker = P::Worker;
        fn worker(&self) -> P::Worker {
            (**self).worker()
        }
        fn embed(&self, worker: &mut P::Worker, window: &[f32]) -> Result<Embedding, String> {
            (**self).embed(worker, window)
        }
    }

    // ── With the model ────────────────────────────────────────────────
    //
    // These need the pinned model file; CI downloads it once and caches it:
    //   SONOLECT_SPEAKER_MODEL=/path/to/model.onnx \
    //     cargo test --locked -- --ignored speakers::tests::model_

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join(name)
    }

    fn model_file() -> PathBuf {
        PathBuf::from(
            std::env::var_os("SONOLECT_SPEAKER_MODEL")
                .expect("Set SONOLECT_SPEAKER_MODEL to the speaker model file"),
        )
    }

    fn model() -> Campplus {
        let bytes = model_download::read_verified(&model_file(), &SPEAKER_MODEL)
            .expect("SONOLECT_SPEAKER_MODEL is not the pinned speaker model");
        Campplus::from_bytes(&bytes).unwrap()
    }

    /// The reference turns of an RTTM file: start, end (seconds) and speaker.
    fn rttm(path: &Path) -> Vec<(f32, f32, String)> {
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .filter_map(|line| {
                let fields: Vec<&str> = line.split_whitespace().collect();
                (fields.first() == Some(&"SPEAKER")).then(|| {
                    let start: f32 = fields[3].parse().unwrap();
                    let length: f32 = fields[4].parse().unwrap();
                    (start, start + length, fields[7].to_owned())
                })
            })
            .collect()
    }

    /// How much of the reference speech lands on the right speaker when each
    /// reference turn takes the detected speaker it overlaps most, under the
    /// best pairing of reference and detected speakers. This is what labels
    /// transcript segments, which take the speaker they overlap most.
    fn accuracy(reference: &[(f32, f32, String)], found: &[SpeakerTurn]) -> f32 {
        let mut names: Vec<&str> = reference.iter().map(|(_, _, name)| name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        let detected = found.iter().map(|turn| turn.speaker).max().unwrap_or(0) as usize;
        // time[reference speaker][detected speaker]
        let mut time = vec![vec![0f32; detected.max(1)]; names.len()];
        for (start, end, name) in reference {
            let mut overlap = vec![0f32; detected.max(1)];
            for turn in found {
                let (a, b) = (turn.start_ms as f32 / 1000.0, turn.end_ms as f32 / 1000.0);
                overlap[turn.speaker as usize - 1] += (end.min(b) - start.max(a)).max(0.0);
            }
            let best = (0..overlap.len()).max_by(|a, b| overlap[*a].total_cmp(&overlap[*b]));
            if let Some(best) = best.filter(|best| overlap[*best] > 0.0) {
                time[names.iter().position(|n| n == name).unwrap()][best] += end - start;
            }
        }
        // The best one-to-one pairing, trying every order (a few speakers).
        fn best(time: &[Vec<f32>], row: usize, used: &mut Vec<bool>) -> f32 {
            if row == time.len() {
                return 0.0;
            }
            let mut top = best(time, row + 1, used);
            for column in 0..used.len() {
                if !used[column] {
                    used[column] = true;
                    top = top.max(time[row][column] + best(time, row + 1, used));
                    used[column] = false;
                }
            }
            top
        }
        let total: f32 = reference.iter().map(|(start, end, _)| end - start).sum();
        best(&time, 0, &mut vec![false; detected.max(1)]) / total
    }

    #[test]
    #[ignore = "needs the speaker model: set SONOLECT_SPEAKER_MODEL"]
    fn model_matches_onnxruntime() {
        let mut clip = hound::WavReader::open(fixture("speaker-clip.wav")).unwrap();
        let samples: Vec<f32> = clip
            .samples::<i16>()
            .map(|sample| f32::from(sample.unwrap()) / 32768.0)
            .collect();
        assert_eq!(samples.len(), WINDOW);
        let expected: Vec<f32> = fs::read(fixture("speaker-clip-embedding.f32"))
            .unwrap()
            .as_chunks::<4>()
            .0
            .iter()
            .map(|bytes| f32::from_le_bytes(*bytes))
            .collect();
        assert_eq!(expected.len(), EMBEDDING);
        let model = model();
        let print = model.embed(&mut model.worker(), &samples).unwrap();
        let norm = expected
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            .sqrt();
        let cosine: f32 = print.iter().zip(&expected).map(|(a, b)| a * b).sum::<f32>() / norm;
        println!("cosine with onnxruntime: {cosine:.6}");
        assert!(cosine >= 0.999, "cosine {cosine}");
    }

    #[test]
    #[ignore = "needs the speaker model: set SONOLECT_SPEAKER_MODEL"]
    fn model_finds_the_two_speakers_of_the_dialogue() {
        let folder = tempfile::tempdir().unwrap();
        // Stored as the app stores it: Ogg Opus from its own encoder.
        fs::copy(
            fixture("two-speakers.opus"),
            folder.path().join("890-1.opus"),
        )
        .unwrap();
        let reference = rttm(&fixture("two-speakers.rttm"));
        let model = model();
        for speakers in [None, Some(2)] {
            let started = std::time::Instant::now();
            let turns = detect_saved(
                folder.path(),
                "890-1",
                || Ok(&model),
                speakers,
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .unwrap();
            let found = turns.iter().map(|turn| turn.speaker).max().unwrap_or(0);
            let accuracy = accuracy(&reference, &turns);
            println!(
                "speakers {speakers:?}: found {found}, accuracy {accuracy:.3}, {} turns, {:?}",
                turns.len(),
                started.elapsed()
            );
            assert_eq!(found, 2, "{turns:?}");
            assert!(accuracy >= 0.95, "accuracy {accuracy}");
        }
    }

    #[test]
    #[ignore = "needs the speaker model: set SONOLECT_SPEAKER_MODEL"]
    fn model_cli_prints_the_turns_as_json() {
        let args = [
            fixture("two-speakers.opus").to_string_lossy().into_owned(),
            model_file().to_string_lossy().into_owned(),
        ];
        let json: serde_json::Value = serde_json::from_str(&cli(&args).unwrap()).unwrap();
        let turns = json.as_array().unwrap();
        assert!(turns.len() > 10);
        let first = &turns[0];
        assert_eq!(first["speaker"], 1);
        assert!(first["startMs"].as_u64().unwrap() < first["endMs"].as_u64().unwrap());
        let mut speakers: Vec<u64> = turns
            .iter()
            .map(|t| t["speaker"].as_u64().unwrap())
            .collect();
        speakers.sort_unstable();
        speakers.dedup();
        assert_eq!(speakers, [1, 2]);
        // A known count is passed through.
        let args = [args[0].clone(), args[1].clone(), "2".into()];
        assert!(cli(&args).unwrap().starts_with('['));
    }

    /// Not a test: writes fixtures/two-speakers.opus from the WAV that
    /// fixtures/make-speaker-fixtures.py made, with the app's own encoder.
    #[test]
    #[ignore = "regenerates a fixture; run by fixtures/make-speaker-fixtures.py"]
    fn write_dialogue_fixture() {
        let wav = std::env::var_os("SONOLECT_FIXTURE_WAV").expect("Set SONOLECT_FIXTURE_WAV");
        let folder = tempfile::tempdir().unwrap();
        fs::copy(wav, folder.path().join("1-1.wav")).unwrap();
        assert!(compact_audio::compress(folder.path(), "1-1").unwrap() > 0);
        fs::copy(folder.path().join("1-1.opus"), fixture("two-speakers.opus")).unwrap();
    }
}
