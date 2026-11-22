//! Durable local recordings: write audio before inference; retain errors for retry.
//!
//! Each recording is `{id}.json` (the note) beside `{id}.wav` or `{id}.opus`
//! (its audio). Notes that came through sync have no audio file: recordings
//! do not sync, so everything here copes with a note that has none.
use super::sync::Hlc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub id: String,
    pub created_at_ms: u64,
    pub duration_ms: u64,
    pub transcript: Option<String>,
    pub error: Option<String>,
    pub language: Option<String>,
    /// Timed segments from the engine, or as edited in the studio. Records
    /// written before segments were stored simply have none.
    #[serde(default)]
    pub segments: Vec<super::WhisperSegment>,
    // The fields below are those a synced note (note/1) carries beyond a
    // recording's. They are kept as received; recordings made here before
    // sync have none of them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refined_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    /// The app that made the note ("desktop" or "mobile"); absent: this one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// On a conflict copy: the note it was copied from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict_of: Option<String>,
    /// When the text last changed (ms).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at_ms: Option<u64>,
    /// The note's version for sync, stamped on every change while sync is on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hlc: Option<Hlc>,
    /// Fields of a synced note that this version does not know, kept as they
    /// are so that no device drops another's data.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

/// One change to the saved records at a time, so a note that arrives through
/// sync and a change made on this device never interleave.
static RECORDS: Mutex<()> = Mutex::new(());

pub(super) fn lock() -> MutexGuard<'static, ()> {
    RECORDS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Where this device keeps its recordings, and its sync folder when the
/// build syncs.
pub(super) struct Library {
    captures: PathBuf,
    sync: Option<PathBuf>,
}

impl Library {
    pub(super) fn open(app: &tauri::AppHandle) -> Result<Self, String> {
        Ok(Self {
            captures: directory(app)?,
            sync: super::sync::folder(app),
        })
    }

    /// Saves a change made on this device. While sync is on it gets a new
    /// version, so it reaches the other devices and wins over the one it
    /// replaces; while sync is off the version is dropped, and the engine
    /// dates the note by its own times when sync starts.
    fn save_local(&self, capture: &mut Capture) -> Result<(), String> {
        capture.hlc = self.sync.as_deref().and_then(|sync| {
            super::sync::local_stamp(sync, capture.hlc.as_ref(), super::sync::now_ms())
        });
        store(&self.captures, capture)
    }
}

pub(super) fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("captures");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory)
}
/// Recording ids: this device's own (digits and '-') and those of synced
/// notes, `[A-Za-z0-9_-]{1,64}`. Nothing else, so a path never leaves the
/// folder.
pub(super) fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid recording ID.".into());
    }
    Ok(())
}

/// Names Windows keeps for devices ("CON", "NUL", "COM1", with any
/// extension). A note with such an id cannot be a file there, so no desktop
/// stores one.
fn reserved_name(id: &str) -> bool {
    let name = id.to_ascii_uppercase();
    matches!(name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (name.len() == 4
            && (name.starts_with("COM") || name.starts_with("LPT"))
            && name.as_bytes()[3].is_ascii_digit())
}

/// Writes `bytes` to `temp`, then puts it in the place of `path`. The bytes
/// are on the disk before the rename, so a crash or a power cut leaves the
/// old file or the new one, never an empty or half-written one.
pub(super) fn replace_file(temp: &Path, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = fs::File::create(temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    // Rename replaces atomically on supported desktop filesystems.
    fs::rename(temp, path)
}

/// Writes a record whole or not at all.
fn store(directory: &Path, capture: &Capture) -> Result<(), String> {
    let path = directory.join(format!("{}.json", capture.id));
    let temp = directory.join(format!("{}.json.tmp", capture.id));
    let bytes = serde_json::to_vec(capture).map_err(|e| e.to_string())?;
    replace_file(&temp, &path, &bytes).map_err(|e| e.to_string())
}

/// What a change to a recording answers once the user has deleted it.
pub(super) const NOT_IN_LIBRARY: &str = "This recording is no longer in your library.";

/// Sent to the webview after a note changes on this device while sync is on,
/// so the change reaches the other devices soon.
pub const LOCAL_CHANGE_EVENT: &str = "sync-local-change";

fn changed_here(app: &tauri::AppHandle, library: &Library) {
    if library.sync.as_deref().is_some_and(super::sync::is_on) {
        let _ = app.emit(LOCAL_CHANGE_EVENT, ());
    }
}

/// Saves a recording made or changed on this device.
pub(super) fn write_record(app: &tauri::AppHandle, capture: &mut Capture) -> Result<(), String> {
    let library = Library::open(app)?;
    {
        let _records = lock();
        library.save_local(capture)?;
    }
    changed_here(app, &library);
    Ok(())
}

/// Saves a recording made on this device once it is transcribed, unless the
/// user deleted it meanwhile (see `Library::save_if_kept`). Returns whether
/// it was saved.
pub(super) fn write_record_if_kept(
    app: &tauri::AppHandle,
    capture: &mut Capture,
) -> Result<bool, String> {
    let library = Library::open(app)?;
    let kept = library.save_if_kept(capture)?;
    if kept {
        changed_here(app, &library);
    }
    Ok(kept)
}

impl Library {
    /// Saves a recording made on this device whose record was saved before
    /// it was transcribed, unless that record is gone: the user deleted the
    /// note, or all their data, while it was transcribed. A deleted note
    /// does not come back, and its delete still reaches the other devices.
    /// Returns whether it was saved.
    fn save_if_kept(&self, capture: &mut Capture) -> Result<bool, String> {
        let _records = lock();
        let path = self.captures.join(format!("{}.json", capture.id));
        // Only a record known to be gone counts as deleted.
        if matches!(path.try_exists(), Ok(false)) {
            return Ok(false);
        }
        self.save_local(capture)?;
        Ok(true)
    }

    /// Changes a saved record, read again under the lock so that a synced
    /// change that arrived meanwhile (a long transcription, say) is kept.
    /// A record that is gone is made by `missing`, or stays gone when that
    /// gives none: the answer is then `None`. Otherwise it says whether the
    /// note changed: a change to the local-only error alone (a Retry that
    /// failed) is saved as it is, with no new version, so it neither reaches
    /// the other devices nor wins over their edits.
    fn change<T>(
        &self,
        id: &str,
        missing: impl FnOnce() -> Option<Capture>,
        change: impl FnOnce(&mut Capture) -> T,
    ) -> Result<Option<(T, bool)>, String> {
        let _records = lock();
        let Some(mut record) = read_record(&self.captures, id).or_else(missing) else {
            return Ok(None);
        };
        let before = record.clone();
        let outcome = change(&mut record);
        let changed = Capture {
            error: before.error.clone(),
            ..record.clone()
        } != before;
        if changed {
            record.updated_at_ms = Some(super::sync::now_ms());
            self.save_local(&mut record)?;
        } else {
            store(&self.captures, &record)?;
        }
        Ok(Some((outcome, changed)))
    }
}

/// Changes a saved record (see `Library::change`).
pub(super) fn change_record<T>(
    app: &tauri::AppHandle,
    id: &str,
    missing: impl FnOnce() -> Option<Capture>,
    change: impl FnOnce(&mut Capture) -> T,
) -> Result<Option<T>, String> {
    let library = Library::open(app)?;
    let Some((outcome, changed)) = library.change(id, missing, change)? else {
        return Ok(None);
    };
    if changed {
        changed_here(app, &library);
    }
    Ok(Some(outcome))
}

/// The saved record of one recording, when it exists and can be read.
pub(super) fn read_record(directory: &Path, id: &str) -> Option<Capture> {
    let data = fs::read(directory.join(format!("{id}.json"))).ok()?;
    serde_json::from_slice(&data).ok()
}

/// The files a recording can have besides its record: its audio as WAV, as
/// Opus and as a high-quality Opus copy made while recording (`hq.opus`), and
/// what an interruption can leave half written.
const RECORDING_FILES: [&str; 5] = ["wav", "opus", "hq.opus", "opus.tmp", "json.tmp"];

/// Removes a recording's files: its audio, their leftovers and its record,
/// the record last, so a recording that could not be removed whole stays in
/// the library.
fn delete_recording(directory: &Path, id: &str) -> Result<(), String> {
    for extension in RECORDING_FILES.into_iter().chain(["json"]) {
        let path = directory.join(format!("{id}.{extension}"));
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Throws away a recording that never joined the library (cancelled, or
/// without audio). Unlike a delete, nothing is told to the other devices.
pub(super) fn discard(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    valid_id(id)?;
    let directory = directory(app)?;
    let _records = lock();
    delete_recording(&directory, id)
}

pub fn process(
    app: &tauri::AppHandle,
    payload: super::WhisperPayload,
    id: Option<String>,
) -> Result<super::WhisperResult, String> {
    process_with(app, payload, id, |payload| {
        super::local_engine::transcribe(app, payload)
    })
}
pub fn process_with(
    app: &tauri::AppHandle,
    payload: super::WhisperPayload,
    id: Option<String>,
    transcribe: impl FnOnce(super::WhisperPayload) -> Result<super::WhisperResult, String>,
) -> Result<super::WhisperResult, String> {
    let library = Library::open(app)?;
    library.record_and_transcribe(payload, id, transcribe, || changed_here(app, &library))
}

impl Library {
    /// Saves a recording, marked for retry, then transcribes it and saves
    /// what came of it. `saved` runs after each save. A note the user
    /// deletes while it is transcribed stays deleted: its text is still
    /// answered, without a saved recording to point to.
    fn record_and_transcribe(
        &self,
        payload: super::WhisperPayload,
        id: Option<String>,
        transcribe: impl FnOnce(super::WhisperPayload) -> Result<super::WhisperResult, String>,
        saved: impl Fn(),
    ) -> Result<super::WhisperResult, String> {
        if payload.audio_bytes.is_empty() || payload.audio_bytes.len() > 5_800_044 {
            return Err("Invalid recording size.".into());
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?;
        let id = id.unwrap_or_else(|| format!("{}-{}", now.as_nanos(), std::process::id()));
        valid_id(&id)?;
        let _hold = super::compact_audio::hold(&id);
        let wav = self.captures.join(format!("{id}.wav"));
        fs::write(wav, &payload.audio_bytes).map_err(|e| format!("Cannot save recording: {e}"))?;
        let mut record = Capture {
            id,
            created_at_ms: now.as_millis() as u64,
            duration_ms: payload.duration_ms,
            transcript: None,
            error: Some("Processing was interrupted. Retry this recording.".into()),
            language: payload.language.clone(),
            ..Default::default()
        };
        {
            let _records = lock();
            self.save_local(&mut record)?;
        }
        saved();
        let mut result = transcribe(payload);
        match &mut result {
            Ok(output) => {
                record.transcript = Some(output.text.clone());
                record.error = None;
                record.language = output.language.clone();
                record.segments = output.segments.clone();
            }
            Err(error) => record.error = Some(error.clone()),
        }
        if self.save_if_kept(&mut record)? {
            saved();
            if let Ok(output) = &mut result {
                output.capture_id = Some(record.id.clone());
            }
        }
        result
    }
}
/// A recording as the library lists it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    #[serde(flatten)]
    capture: Capture,
    /// False for a note that came through sync (recordings do not sync), or
    /// one whose audio is gone: it cannot be played or transcribed again.
    has_audio: bool,
}

fn list_directory(directory: &Path, live: Option<&str>) -> Result<Vec<Listed>, String> {
    let mut captures = vec![];
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(data) = fs::read(&path) {
            if let Ok(capture) = serde_json::from_slice::<Capture>(&data) {
                if live != Some(capture.id.as_str()) {
                    let has_audio =
                        super::compact_audio::audio_file(directory, &capture.id).is_some();
                    captures.push(Listed { capture, has_audio });
                }
            }
        }
    }
    captures.sort_by_key(|listed| std::cmp::Reverse(listed.capture.created_at_ms));
    Ok(captures)
}

/// Off the main thread, as every command here that reads or writes the
/// saved records: a large library takes a while to read.
#[tauri::command(async)]
pub fn list_local_captures(app: tauri::AppHandle) -> Result<Vec<Listed>, String> {
    // The recording in progress joins the library once it is finished.
    list_directory(&directory(&app)?, super::streaming::live_id().as_deref())
}
/// How the audio of a recording is asked for.
#[derive(Clone, Copy, Debug, PartialEq)]
enum AudioRead {
    /// Every recording as WAV, for a webview that cannot play Ogg Opus.
    Wav,
    /// A compressed recording as its Ogg Opus file, for one that can.
    Ogg,
    /// The file the recording is kept in, to be saved elsewhere.
    File,
}
/// "wav" (the default when not given), "ogg" or "file".
fn audio_read(format: Option<&str>) -> Result<AudioRead, String> {
    match format {
        None | Some("wav") => Ok(AudioRead::Wav),
        Some("ogg") => Ok(AudioRead::Ogg),
        Some("file") => Ok(AudioRead::File),
        Some(_) => Err("Invalid audio format.".into()),
    }
}
/// The saved audio of one recording, as a raw binary response, so the studio
/// can play it back and jump to a segment. With `format` "ogg", a compressed
/// recording comes as its Ogg Opus file, for a webview that plays it; with
/// "wav" (the default) every recording comes as WAV. With "file" it comes as
/// it is kept, its Opus file when it has one, so "Save audio" can save it
/// (a high-quality recording, say) without converting it.
#[tauri::command]
pub async fn read_local_capture_audio(
    app: tauri::AppHandle,
    id: String,
    format: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    valid_id(&id)?;
    let read = audio_read(format.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = directory(&app)?;
        match read {
            AudioRead::Wav => super::compact_audio::read_for_playback(&directory, &id, false),
            AudioRead::Ogg => super::compact_audio::read_for_playback(&directory, &id, true),
            AudioRead::File => super::compact_audio::read_saved_file(&directory, &id),
        }
        .map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}

const MAX_EDIT_TRANSCRIPT_BYTES: usize = 2_000_000;
const MAX_EDIT_SEGMENTS: usize = 20_000;
const MAX_SPEAKER_CHARS: usize = 80;

/// Checks an edited transcript before it replaces the saved one, and tidies
/// the speaker labels.
fn validated_edit(
    transcript: String,
    segments: Vec<super::WhisperSegment>,
) -> Result<(String, Vec<super::WhisperSegment>), String> {
    let segment_bytes: usize = segments.iter().map(|segment| segment.text.len()).sum();
    if transcript.len() > MAX_EDIT_TRANSCRIPT_BYTES
        || segment_bytes > MAX_EDIT_TRANSCRIPT_BYTES
        || segments.len() > MAX_EDIT_SEGMENTS
    {
        return Err("The edited transcript is too large to save.".into());
    }
    let mut cleaned = Vec::with_capacity(segments.len());
    for mut segment in segments {
        if segment.end_ms < segment.start_ms {
            return Err("A segment ends before it starts.".into());
        }
        segment.speaker = match segment.speaker.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(speaker) if speaker.chars().count() > MAX_SPEAKER_CHARS => {
                return Err("Speaker names can have up to 80 characters.".into());
            }
            Some(speaker) => Some(speaker.to_owned()),
        };
        cleaned.push(segment);
    }
    Ok((transcript, cleaned))
}

/// The version of a note the studio opened (its HLC then, or none).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditBase {
    #[serde(default)]
    hlc: Option<Hlc>,
}

/// What a studio save did.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditSaved {
    /// The note's version now: the studio's next base.
    #[serde(skip_serializing_if = "Option::is_none")]
    hlc: Option<Hlc>,
    /// The version the studio never saw, kept as a conflict copy.
    #[serde(skip_serializing_if = "Option::is_none")]
    conflict_copy: Option<String>,
}

fn base36(mut value: u64) -> String {
    let mut digits = vec![];
    loop {
        digits.push(char::from_digit((value % 36) as u32, 36).unwrap_or('0'));
        value /= 36;
        if value == 0 {
            break;
        }
    }
    digits.iter().rev().collect()
}

/// sync-core's `conflictCopyId`: the id of the copy of note `id` whose
/// version `loser` lost, the same on every device.
fn conflict_copy_id(id: &str, loser: &Hlc) -> String {
    let counter = if loser.c > 0 {
        format!("x{}", base36(loser.c))
    } else {
        String::new()
    };
    let device: String = loser.d.chars().take(4).collect();
    let suffix = format!("-c{}{counter}{device}", base36(loser.t));
    let keep = 64usize.saturating_sub(suffix.len()).max(1);
    let mut copy: String = id.chars().take(keep).collect();
    copy.push_str(&suffix);
    copy.chars().take(64).collect()
}

/// Segments the studio sends back carry only what it edits. Fields it does
/// not know (another version's, kept as `extra`) come back from the saved
/// segment with the same timings.
fn keep_segment_extras(saved: &[super::WhisperSegment], edited: &mut [super::WhisperSegment]) {
    // The saved segments with each timing, in order: each edited segment
    // takes the first one not taken yet.
    let mut timed: HashMap<(u64, u64), VecDeque<usize>> = HashMap::new();
    for (index, old) in saved.iter().enumerate() {
        timed
            .entry((old.start_ms, old.end_ms))
            .or_default()
            .push_back(index);
    }
    for segment in edited {
        let Some(index) = timed
            .get_mut(&(segment.start_ms, segment.end_ms))
            .and_then(VecDeque::pop_front)
        else {
            continue;
        };
        for (key, value) in &saved[index].extra {
            segment
                .extra
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
    }
}

/// Whether two transcripts say the same words, whatever the spacing. The
/// studio does not send a note's text back as it was stored: it splits a
/// text without timings into sentences, trims each segment and joins them
/// with blank lines (a recording's own text joins them with a space), so a
/// save that only names a speaker still changes the whitespace.
fn same_words(saved: &str, edited: &str) -> bool {
    saved.split_whitespace().eq(edited.split_whitespace())
}

/// Saves a studio edit. With a `base` (the version the studio opened), a
/// note that sync changed meanwhile is not overwritten unseen: the edit
/// becomes the note, as the latest change, and the version the studio never
/// showed is kept as a conflict copy, as the sync engine keeps the losing
/// side of two edits.
fn update_record(
    library: &Library,
    id: &str,
    transcript: String,
    segments: Vec<super::WhisperSegment>,
    base: Option<&EditBase>,
) -> Result<EditSaved, String> {
    let (transcript, mut segments) = validated_edit(transcript, segments)?;
    let _records = lock();
    let mut record = read_record(&library.captures, id).ok_or(NOT_IN_LIBRARY)?;
    let now = super::sync::now_ms();
    let conflict_copy = match base {
        Some(base) if base.hlc != record.hlc => {
            let loser = record.hlc.clone().unwrap_or_else(|| Hlc {
                t: record.updated_at_ms.unwrap_or(record.created_at_ms),
                c: 0,
                d: "here".into(),
            });
            let mut copy = record.clone();
            copy.id = conflict_copy_id(id, &loser);
            copy.conflict_of = Some(id.to_owned());
            copy.error = None;
            copy.updated_at_ms = Some(now);
            library.save_local(&mut copy)?;
            Some(copy.id)
        }
        _ => None,
    };
    keep_segment_extras(&record.segments, &mut segments);
    // The studio edits the transcript, and the phone shows a note's refined
    // text when it has one. Once a word is edited here, that refined text
    // no longer says what the note says: it is dropped, so the phone shows
    // the edit too. A save that changes no word keeps it.
    if !record
        .transcript
        .as_deref()
        .is_some_and(|saved| same_words(saved, &transcript))
    {
        record.refined_text = None;
    }
    record.transcript = Some(transcript);
    record.segments = segments;
    record.updated_at_ms = Some(now);
    library.save_local(&mut record)?;
    Ok(EditSaved {
        hlc: record.hlc,
        conflict_copy,
    })
}

/// Saves the transcript and segments edited in the studio back to a recording.
#[tauri::command(async)]
pub fn update_local_capture(
    app: tauri::AppHandle,
    id: String,
    transcript: String,
    segments: Vec<super::WhisperSegment>,
    base: Option<EditBase>,
) -> Result<EditSaved, String> {
    valid_id(&id)?;
    let library = Library::open(&app)?;
    let saved = update_record(&library, &id, transcript, segments, base.as_ref())?;
    changed_here(&app, &library);
    Ok(saved)
}

impl Library {
    /// A delete the user asked for. While sync is on, it is kept for the
    /// sync engine first, so the note goes from the other devices too.
    fn delete_by_user(&self, id: &str) -> Result<(), String> {
        let _records = lock();
        if let Some(sync) = &self.sync {
            let hlc = read_record(&self.captures, id).and_then(|record| record.hlc);
            super::sync::record_delete(sync, id, hlc, super::sync::now_ms())?;
        }
        delete_recording(&self.captures, id)
    }
}

/// Deletes a recording at the user's request.
#[tauri::command(async)]
pub fn delete_local_capture(app: tauri::AppHandle, id: String) -> Result<(), String> {
    valid_id(&id)?;
    let library = Library::open(&app)?;
    library.delete_by_user(&id)?;
    changed_here(&app, &library);
    Ok(())
}
/// Deletes saved recordings and transcripts from this device: every capture
/// when `older_than_days` is `None` ("Delete all my data"), otherwise those
/// recorded more than that many days ago and not pinned (the retention
/// setting). Returns how many recordings were removed. Neither is a delete
/// for sync: the other devices keep their copies.
#[tauri::command(async)]
pub fn purge_local_captures(
    app: tauri::AppHandle,
    older_than_days: Option<u32>,
) -> Result<u32, String> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    purge_directory(&directory(&app)?, older_than_days, now_ms)
}

fn purge_directory(
    directory: &std::path::Path,
    older_than_days: Option<u32>,
    now_ms: u64,
) -> Result<u32, String> {
    let cutoff_ms = older_than_days.map(|days| now_ms.saturating_sub(u64::from(days) * 86_400_000));
    let mut removed = 0;
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_owned();
        let expired = match cutoff_ms {
            None => true,
            Some(cutoff_ms) => {
                if let Some(id) = name.strip_suffix(".json") {
                    let created = fs::read(&path)
                        .ok()
                        .and_then(|data| serde_json::from_slice::<Capture>(&data).ok())
                        // Pinned notes are kept, as on the phone.
                        .filter(|capture| capture.pinned != Some(true))
                        .map(|capture| capture.created_at_ms);
                    match created {
                        Some(created) if created < cutoff_ms => {
                            for extension in RECORDING_FILES {
                                let _ =
                                    fs::remove_file(directory.join(format!("{id}.{extension}")));
                            }
                            true
                        }
                        _ => false,
                    }
                } else if name.starts_with("system-") && name.ends_with(".wav") {
                    // System-audio recordings have no record; use the file time.
                    fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|t| (t.as_millis() as u64) < cutoff_ms)
                        .unwrap_or(false)
                } else {
                    false
                }
            }
        };
        if expired {
            match fs::remove_file(&path) {
                Ok(()) => {}
                // Already removed alongside its record earlier in this loop.
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(format!("Could not delete {name}: {error}")),
            }
            // One record (or one system-audio file) per recording.
            if name.ends_with(".json") || name.starts_with("system-") {
                removed += 1;
            }
        }
    }
    Ok(removed)
}
/// Compresses every finished recording that is still a WAV to Ogg Opus,
/// about a tenth of the size. The studio calls it after each recording when
/// the user chose compressed storage, and from "Compress recordings now".
#[tauri::command]
pub async fn compress_local_captures(
    app: tauri::AppHandle,
) -> Result<super::compact_audio::Compressed, String> {
    tauri::async_runtime::spawn_blocking(move || {
        super::compact_audio::compress_all(&directory(&app)?)
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Transcribes a saved recording again with the local engine. Recordings of
/// any length are handled chunk by chunk, with the same live text events as a
/// recording in progress.
#[tauri::command]
pub async fn retry_local_capture(
    app: tauri::AppHandle,
    id: String,
    model_path: Option<String>,
    language: Option<String>,
) -> Result<super::WhisperResult, String> {
    valid_id(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        // A synced note has no audio here: there is nothing to transcribe,
        // and its text stays as it is.
        if super::compact_audio::audio_file(&directory(&app)?, &id).is_none() {
            return Err(super::compact_audio::GONE.into());
        }
        super::streaming::retranscribe(&app, &id, model_path, language)
    })
    .await
    .map_err(|e| e.to_string())?
}
// ── Notes for the sync engine ──────────────────────────────────────────

/// A note as the sync engine lists it: cheap, without its text.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    hlc: Option<Hlc>,
    created_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at_ms: Option<u64>,
}

/// What the engine expects the local note to be before it writes a remote
/// change (sync-core's `LocalExpectation`): absent, or present with this HLC.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Expected {
    exists: bool,
    #[serde(default)]
    hlc: Option<Hlc>,
}

/// What became of a remote change.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Applied {
    /// Written, or deleted, as asked.
    Written,
    /// The note changed here meanwhile: nothing was written, and the engine
    /// tries again on its next run.
    Changed,
    /// This device cannot keep this note: its id names a device on Windows,
    /// or another note's file where file names ignore case.
    Skipped,
}

/// The notes that take part in sync: those with a transcript (a recording
/// that failed has nothing to sync yet), except the recording in progress.
fn syncable(capture: &Capture, live: Option<&str>) -> bool {
    capture.transcript.is_some() && live != Some(capture.id.as_str())
}

/// The record saved as `{id}.json`, when it really is that note: where file
/// names ignore case, the file could belong to another.
fn read_note(directory: &Path, id: &str) -> Option<Capture> {
    read_record(directory, id).filter(|capture| capture.id == id)
}

fn matches(local: Option<&Capture>, expected: &Expected) -> bool {
    match local {
        None => !expected.exists,
        Some(local) => expected.exists && local.hlc == expected.hlc,
    }
}

fn sync_summaries(directory: &Path, live: Option<&str>) -> Result<Vec<SyncSummary>, String> {
    let mut notes = vec![];
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        if let Some(capture) = read_note(directory, id).filter(|c| syncable(c, live)) {
            notes.push(SyncSummary {
                id: capture.id,
                hlc: capture.hlc,
                created_at_ms: capture.created_at_ms,
                updated_at_ms: capture.updated_at_ms,
            });
        }
    }
    Ok(notes)
}

impl Library {
    /// Writes a note that came through sync, without audio, only if the
    /// local note is still what the engine expects (`None`: a conflict copy,
    /// written whatever is there). The local-only error is kept.
    fn upsert_synced(
        &self,
        mut note: Capture,
        expected: Option<&Expected>,
        live: Option<&str>,
    ) -> Result<Applied, String> {
        valid_id(&note.id)?;
        if note.transcript.is_none() || !note.hlc.as_ref().is_some_and(Hlc::is_valid) {
            return Err("Invalid synced note.".into());
        }
        if reserved_name(&note.id) {
            return Ok(Applied::Skipped);
        }
        let _records = lock();
        let existing = read_record(&self.captures, &note.id);
        if existing.as_ref().is_some_and(|saved| saved.id != note.id) {
            return Ok(Applied::Skipped);
        }
        if live == Some(note.id.as_str()) {
            return Ok(Applied::Changed);
        }
        let visible = existing.as_ref().filter(|saved| syncable(saved, live));
        if expected.is_some_and(|expected| !matches(visible, expected)) {
            return Ok(Applied::Changed);
        }
        note.error = existing.and_then(|saved| saved.error);
        store(&self.captures, &note)?;
        Ok(Applied::Written)
    }

    /// Deletes a note deleted on another device, with its audio if this
    /// device has it, only if the note is still what the engine expects.
    fn delete_synced(
        &self,
        id: &str,
        expected: &Expected,
        live: Option<&str>,
    ) -> Result<Applied, String> {
        valid_id(id)?;
        if reserved_name(id) {
            return Ok(Applied::Skipped);
        }
        let _records = lock();
        let existing = read_record(&self.captures, id);
        if existing.as_ref().is_some_and(|saved| saved.id != id) {
            return Ok(Applied::Skipped);
        }
        let visible = existing.as_ref().filter(|saved| syncable(saved, live));
        // Audio being recorded or transcribed stays until that is over.
        if !matches(visible, expected) || super::compact_audio::held(id) {
            return Ok(Applied::Changed);
        }
        if visible.is_some() {
            delete_recording(&self.captures, id)?;
        }
        Ok(Applied::Written)
    }
}

/// Every note that takes part in sync, without its text.
#[tauri::command(async)]
pub fn list_sync_notes(app: tauri::AppHandle) -> Result<Vec<SyncSummary>, String> {
    sync_summaries(&directory(&app)?, super::streaming::live_id().as_deref())
}

/// One note for the sync engine, with every field it holds.
#[tauri::command(async)]
pub fn read_sync_note(app: tauri::AppHandle, id: String) -> Result<Option<Capture>, String> {
    valid_id(&id)?;
    let live = super::streaming::live_id();
    Ok(read_note(&directory(&app)?, &id).filter(|capture| syncable(capture, live.as_deref())))
}

/// Writes a note that came through sync (see `Library::upsert_synced`).
#[tauri::command(async)]
pub fn upsert_synced_capture(
    app: tauri::AppHandle,
    capture: Capture,
    expected: Option<Expected>,
) -> Result<Applied, String> {
    Library::open(&app)?.upsert_synced(
        capture,
        expected.as_ref(),
        super::streaming::live_id().as_deref(),
    )
}

/// Applies a delete made on another device (see `Library::delete_synced`).
#[tauri::command(async)]
pub fn apply_remote_delete(
    app: tauri::AppHandle,
    id: String,
    expected: Expected,
) -> Result<Applied, String> {
    Library::open(&app)?.delete_synced(&id, &expected, super::streaming::live_id().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WhisperSegment;
    use std::fs;

    /// The library in `directory`, without sync.
    fn library(directory: &Path) -> Library {
        Library {
            captures: directory.into(),
            sync: None,
        }
    }

    /// Every kind of file a recording can leave, besides its record.
    const EVERY_KIND: [&str; 5] = ["wav", "opus", "hq.opus", "opus.tmp", "json.tmp"];

    fn every_file(directory: &std::path::Path, id: &str) {
        for extension in EVERY_KIND {
            fs::write(directory.join(format!("{id}.{extension}")), b"audio").unwrap();
        }
    }

    fn files_of(directory: &std::path::Path, id: &str) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter(|name| name.starts_with(&format!("{id}.")))
            .collect();
        names.sort();
        names
    }

    fn record(directory: &std::path::Path, id: &str, created_at_ms: u64) {
        let capture = Capture {
            id: id.into(),
            created_at_ms,
            duration_ms: 1000,
            transcript: Some("hello".into()),
            ..Default::default()
        };
        fs::write(
            directory.join(format!("{id}.json")),
            serde_json::to_vec(&capture).unwrap(),
        )
        .unwrap();
        fs::write(directory.join(format!("{id}.wav")), b"RIFF").unwrap();
    }

    #[test]
    fn retention_deletes_only_expired_recordings() {
        // A fresh, randomly named folder that is removed when the test ends.
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        let day = 86_400_000;
        let now = 100 * day;
        record(directory, "1-1", now - 40 * day);
        record(directory, "2-1", now - 2 * day);
        fs::write(directory.join("notes.txt"), b"keep").unwrap();

        assert_eq!(purge_directory(directory, Some(30), now).unwrap(), 1);
        assert!(!directory.join("1-1.json").exists());
        assert!(!directory.join("1-1.wav").exists());
        assert!(directory.join("2-1.json").exists());
        assert!(directory.join("2-1.wav").exists());

        assert_eq!(purge_directory(directory, None, now).unwrap(), 1);
        assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
    }

    #[test]
    fn retention_deletes_compressed_recordings_too() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        let day = 86_400_000;
        let now = 100 * day;
        for (id, age) in [("1-1", 40), ("2-1", 2)] {
            record(directory, id, now - age * day);
            fs::rename(
                directory.join(format!("{id}.wav")),
                directory.join(format!("{id}.opus")),
            )
            .unwrap();
        }
        fs::write(directory.join("1-1.opus.tmp"), b"half").unwrap();

        assert_eq!(purge_directory(directory, Some(30), now).unwrap(), 1);
        assert!(!directory.join("1-1.json").exists());
        assert!(!directory.join("1-1.opus").exists());
        assert!(!directory.join("1-1.opus.tmp").exists());
        assert!(directory.join("2-1.json").exists());
        assert!(directory.join("2-1.opus").exists());
    }

    #[test]
    fn retention_deletes_every_file_of_an_expired_recording() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        let day = 86_400_000;
        let now = 100 * day;
        for (id, age) in [("1-1", 40), ("2-1", 2)] {
            record(directory, id, now - age * day);
            every_file(directory, id);
        }

        assert_eq!(purge_directory(directory, Some(30), now).unwrap(), 1);
        assert!(files_of(directory, "1-1").is_empty());
        assert_eq!(files_of(directory, "2-1").len(), 6);
    }

    #[test]
    fn deleting_all_data_removes_every_kind_of_audio_file() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        record(directory, "1-1", 5);
        every_file(directory, "1-1");
        // Audio whose record is gone, and a system-audio file of old.
        fs::write(directory.join("2-1.hq.opus"), b"audio").unwrap();
        fs::write(directory.join("system-1.wav"), b"RIFF").unwrap();

        assert_eq!(purge_directory(directory, None, 100).unwrap(), 2);
        assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
    }

    #[test]
    fn deleting_a_recording_removes_every_file_it_has() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        for id in ["1-1", "2-1"] {
            record(directory, id, 5);
            every_file(directory, id);
        }
        delete_recording(directory, "1-1").unwrap();
        assert!(files_of(directory, "1-1").is_empty());
        assert_eq!(files_of(directory, "2-1").len(), 6);
        // Nothing left to delete is not an error.
        delete_recording(directory, "1-1").unwrap();
    }

    #[test]
    fn audio_is_read_as_ogg_wav_or_its_file_and_nothing_else() {
        assert_eq!(audio_read(None), Ok(AudioRead::Wav));
        assert_eq!(audio_read(Some("wav")), Ok(AudioRead::Wav));
        assert_eq!(audio_read(Some("ogg")), Ok(AudioRead::Ogg));
        assert_eq!(audio_read(Some("file")), Ok(AudioRead::File));
        for format in ["", "OGG", "opus", "mp3", "../wav", "FILE", "hq.opus"] {
            assert_eq!(
                audio_read(Some(format)),
                Err("Invalid audio format.".to_string())
            );
        }
    }

    fn segment(start_ms: u64, end_ms: u64, text: &str, speaker: Option<&str>) -> WhisperSegment {
        WhisperSegment {
            start_ms,
            end_ms,
            text: text.into(),
            speaker: speaker.map(str::to_owned),
            ..Default::default()
        }
    }

    #[test]
    fn edits_are_saved_with_their_segments_and_speakers() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        record(directory, "3-1", 5);

        update_record(
            &library(directory),
            "3-1",
            "Hello there. General Kenobi.".into(),
            vec![
                segment(0, 900, "Hello there.", Some("  Obi-Wan ")),
                segment(900, 2000, "General Kenobi.", Some(" ")),
            ],
            None,
        )
        .unwrap();

        let saved: Capture =
            serde_json::from_slice(&fs::read(directory.join("3-1.json")).unwrap()).unwrap();
        assert_eq!(
            saved.transcript.as_deref(),
            Some("Hello there. General Kenobi.")
        );
        assert_eq!(saved.created_at_ms, 5);
        assert_eq!(saved.segments.len(), 2);
        assert_eq!(saved.segments[0].speaker.as_deref(), Some("Obi-Wan"));
        assert_eq!(saved.segments[1].speaker, None);
        assert!(!directory.join("3-1.json.tmp").exists());
    }

    #[test]
    fn edits_are_refused_when_invalid_or_the_recording_is_gone() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        record(directory, "4-1", 5);

        assert_eq!(
            update_record(&library(directory), "9-9", "text".into(), vec![], None).unwrap_err(),
            "This recording is no longer in your library."
        );
        assert_eq!(
            update_record(
                &library(directory),
                "4-1",
                "x".repeat(2_000_001),
                vec![],
                None
            )
            .unwrap_err(),
            "The edited transcript is too large to save."
        );
        assert_eq!(
            update_record(
                &library(directory),
                "4-1",
                "text".into(),
                vec![segment(500, 100, "text", None)],
                None,
            )
            .unwrap_err(),
            "A segment ends before it starts."
        );
        assert_eq!(
            update_record(
                &library(directory),
                "4-1",
                "text".into(),
                vec![segment(0, 100, "text", Some(&"n".repeat(81)))],
                None,
            )
            .unwrap_err(),
            "Speaker names can have up to 80 characters."
        );
        let saved: Capture =
            serde_json::from_slice(&fs::read(directory.join("4-1.json")).unwrap()).unwrap();
        assert_eq!(saved.transcript.as_deref(), Some("hello"));
    }

    #[test]
    fn records_saved_before_segments_existed_still_load() {
        let old = br#"{"id":"1-1","createdAtMs":1,"durationMs":2,"transcript":"hi","error":null,"language":"en"}"#;
        let capture: Capture = serde_json::from_slice(old).unwrap();
        assert!(capture.segments.is_empty());
        let with_segments = br#"{"id":"1-1","createdAtMs":1,"durationMs":2,"transcript":"hi","error":null,"language":"en","segments":[{"startMs":0,"endMs":10,"text":"hi"}]}"#;
        let capture: Capture = serde_json::from_slice(with_segments).unwrap();
        assert_eq!(capture.segments, vec![segment(0, 10, "hi", None)]);
    }

    #[test]
    fn rejects_paths_outside_capture_directory() {
        for value in ["../model", "", "C:\\model", "123/4", "1.json"] {
            assert!(super::valid_id(value).is_err());
        }
        assert!(super::valid_id("17889300001234-1000").is_ok());
    }

    #[test]
    fn synced_note_ids_are_accepted_but_paths_are_not() {
        for id in [
            "turn_1700000000000_ab12cd",
            "a",
            "AZaz09-_",
            "17889300001234-1000-c1kz9x2Ab3_",
            &"x".repeat(64),
        ] {
            assert!(valid_id(id).is_ok(), "{id}");
        }
        for id in [
            &"x".repeat(65),
            "a b",
            "a.b",
            "é",
            "a/b",
            "a\\b",
            "..",
            "a\0",
        ] {
            assert!(valid_id(id).is_err(), "{id}");
        }
        for id in ["CON", "con", "Nul", "aux", "PRN", "COM1", "lpt9", "COM0"] {
            assert!(reserved_name(id), "{id}");
        }
        for id in ["COM", "COM10", "CONSOLE", "CON1", "NULL", "COMA", "1-1"] {
            assert!(!reserved_name(id), "{id}");
        }
    }

    fn hlc(t: u64, c: u64, d: &str) -> Hlc {
        Hlc { t, c, d: d.into() }
    }

    fn expected(exists: bool, hlc: Option<Hlc>) -> Expected {
        Expected { exists, hlc }
    }

    /// A note as it arrives from the phone, with fields this version does not know.
    fn synced(id: &str, text: &str, version: Hlc) -> Capture {
        let mut extra = Map::new();
        extra.insert("privacyMode".into(), Value::from("local"));
        let mut segment_extra = Map::new();
        segment_extra.insert("confidence".into(), Value::from(0.9));
        Capture {
            id: id.into(),
            created_at_ms: 1_700_000_000_000,
            duration_ms: 4_000,
            transcript: Some(text.into()),
            language: Some("fr".into()),
            segments: vec![WhisperSegment {
                start_ms: 0,
                end_ms: 4_000,
                text: text.into(),
                speaker: Some("Sam".into()),
                extra: segment_extra,
            }],
            title: Some("Groceries".into()),
            refined_text: Some(format!("{text}.")),
            mode: Some("note".into()),
            pinned: Some(true),
            origin: Some("mobile".into()),
            source: Some("typed".into()),
            updated_at_ms: Some(1_700_000_100_000),
            hlc: Some(version),
            extra,
            ..Default::default()
        }
    }

    fn audio_files(directory: &Path, id: &str) -> Vec<String> {
        ["wav", "opus"]
            .into_iter()
            .filter(|extension| directory.join(format!("{id}.{extension}")).exists())
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn synced_notes_are_written_only_when_the_note_is_as_expected() {
        let folder = tempfile::tempdir().unwrap();
        let notes = library(folder.path());
        let id = "turn_1700000000000_ab12cd";
        let first = synced(id, "Milk and eggs", hlc(10, 0, "phone"));
        assert_eq!(
            notes.upsert_synced(first.clone(), Some(&expected(false, None)), None),
            Ok(Applied::Written)
        );
        // Written whole, with every field kept and no audio.
        assert_eq!(read_note(folder.path(), id), Some(first.clone()));
        assert!(audio_files(folder.path(), id).is_empty());
        assert!(!folder.path().join(format!("{id}.json.tmp")).exists());
        // The engine expected no note, but there is one now.
        assert_eq!(
            notes.upsert_synced(first.clone(), Some(&expected(false, None)), None),
            Ok(Applied::Changed)
        );
        let second = synced(id, "Milk, eggs and bread", hlc(11, 0, "phone"));
        assert_eq!(
            notes.upsert_synced(
                second.clone(),
                Some(&expected(true, Some(hlc(10, 0, "phone")))),
                None
            ),
            Ok(Applied::Written)
        );
        // An expectation older than the note is refused, and nothing changes.
        assert_eq!(
            notes.upsert_synced(
                first.clone(),
                Some(&expected(true, Some(hlc(10, 0, "phone")))),
                None
            ),
            Ok(Applied::Changed)
        );
        assert_eq!(read_note(folder.path(), id), Some(second.clone()));
        // A conflict copy is written whatever is there.
        let copy = Capture {
            id: format!("{id}-c1x"),
            conflict_of: Some(id.into()),
            ..first.clone()
        };
        for _ in 0..2 {
            assert_eq!(
                notes.upsert_synced(copy.clone(), None, None),
                Ok(Applied::Written)
            );
        }
        // The recording in progress is never replaced.
        assert_eq!(
            notes.upsert_synced(second.clone(), None, Some(id)),
            Ok(Applied::Changed)
        );
        // A note without text or without a valid version is refused.
        let mut empty = second.clone();
        empty.transcript = None;
        assert!(notes.upsert_synced(empty, None, None).is_err());
        let mut unversioned = second.clone();
        unversioned.hlc = Some(hlc(1, 0, "a/b"));
        assert!(notes.upsert_synced(unversioned, None, None).is_err());
        let mut outside = second;
        outside.id = "../outside".into();
        assert!(notes.upsert_synced(outside, None, None).is_err());
    }

    #[test]
    fn a_synced_version_keeps_what_is_only_local() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        // A recording here whose transcription failed: not part of sync yet.
        record(directory, "5-1", 5);
        let mut failed = read_record(directory, "5-1").unwrap();
        failed.transcript = None;
        failed.error = Some("Processing was interrupted. Retry this recording.".into());
        store(directory, &failed).unwrap();
        let version = synced("5-1", "Transcribed elsewhere", hlc(3, 0, "other"));
        assert_eq!(
            library(directory).upsert_synced(version, Some(&expected(false, None)), None),
            Ok(Applied::Written)
        );
        let saved = read_record(directory, "5-1").unwrap();
        assert_eq!(saved.transcript.as_deref(), Some("Transcribed elsewhere"));
        assert_eq!(saved.error, failed.error);
        assert_eq!(audio_files(directory, "5-1"), vec!["wav"]);
    }

    #[test]
    fn remote_deletes_remove_the_note_and_its_audio_only_as_expected() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        let notes = library(directory);
        record(directory, "6-1", 5);
        let mut saved = read_record(directory, "6-1").unwrap();
        saved.hlc = Some(hlc(20, 1, "desk"));
        store(directory, &saved).unwrap();
        assert_eq!(
            notes.delete_synced("6-1", &expected(true, Some(hlc(20, 0, "desk"))), None),
            Ok(Applied::Changed)
        );
        assert_eq!(
            notes.delete_synced("6-1", &expected(true, None), None),
            Ok(Applied::Changed)
        );
        {
            // Audio still being transcribed stays until that is over.
            let _transcribing = crate::compact_audio::hold("6-1");
            assert_eq!(
                notes.delete_synced("6-1", &expected(true, Some(hlc(20, 1, "desk"))), None),
                Ok(Applied::Changed)
            );
        }
        assert!(directory.join("6-1.json").exists());
        assert_eq!(
            notes.delete_synced("6-1", &expected(true, Some(hlc(20, 1, "desk"))), None),
            Ok(Applied::Written)
        );
        assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
        // Nothing left to delete is no change.
        assert_eq!(
            notes.delete_synced("6-1", &expected(false, None), None),
            Ok(Applied::Written)
        );
        assert_eq!(
            notes.delete_synced("6-1", &expected(true, None), None),
            Ok(Applied::Changed)
        );
        assert!(notes
            .delete_synced("../6-1", &expected(true, None), None)
            .is_err());
    }

    #[test]
    fn notes_that_cannot_be_files_here_are_skipped() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        let notes = library(directory);
        let version = || synced("con", "Reserved on Windows", hlc(1, 0, "phone"));
        assert_eq!(
            notes.upsert_synced(version(), None, None),
            Ok(Applied::Skipped)
        );
        assert_eq!(
            notes.delete_synced("NUL", &expected(true, None), None),
            Ok(Applied::Skipped)
        );
        assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
        // Where file names ignore case, "abc.json" may hold the note "ABC".
        let other = synced("ABC", "Another note", hlc(1, 0, "phone"));
        fs::write(
            directory.join("abc.json"),
            serde_json::to_vec(&other).unwrap(),
        )
        .unwrap();
        let mine = synced("abc", "This note", hlc(2, 0, "phone"));
        assert_eq!(notes.upsert_synced(mine, None, None), Ok(Applied::Skipped));
        assert_eq!(
            notes.delete_synced("abc", &expected(true, Some(hlc(1, 0, "phone"))), None),
            Ok(Applied::Skipped)
        );
        assert_eq!(read_record(directory, "abc"), Some(other));
        assert_eq!(read_note(directory, "abc"), None);
        assert_eq!(sync_summaries(directory, None), Ok(vec![]));
    }

    #[test]
    fn audio_less_notes_are_listed_and_exported_for_sync() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        record(directory, "1-1", 30);
        let phone = synced("turn_2_abc", "From the phone", hlc(40, 0, "phone"));
        library(directory)
            .upsert_synced(phone.clone(), Some(&expected(false, None)), None)
            .unwrap();
        // A failed recording without audio, and the recording in progress.
        store(
            directory,
            &Capture {
                id: "3-1".into(),
                created_at_ms: 20,
                error: Some("Processing was interrupted. Retry this recording.".into()),
                ..Default::default()
            },
        )
        .unwrap();
        record(directory, "4-1", 50);

        let listed = list_directory(directory, Some("4-1")).unwrap();
        let shown: Vec<(&str, bool)> = listed
            .iter()
            .map(|listed| (listed.capture.id.as_str(), listed.has_audio))
            .collect();
        // Newest first; the recording in progress is not listed yet.
        assert_eq!(
            shown,
            vec![("turn_2_abc", false), ("1-1", true), ("3-1", false)]
        );
        let json = serde_json::to_value(&listed[0]).unwrap();
        assert_eq!(json["id"], "turn_2_abc");
        assert_eq!(json["hasAudio"], false);
        assert_eq!(json["title"], "Groceries");
        assert_eq!(json["extra"]["privacyMode"], "local");
        assert_eq!(json["segments"][0]["confidence"], 0.9);

        let mut summaries = sync_summaries(directory, Some("4-1")).unwrap();
        summaries.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(
            summaries,
            vec![
                SyncSummary {
                    id: "1-1".into(),
                    hlc: None,
                    created_at_ms: 30,
                    updated_at_ms: None,
                },
                SyncSummary {
                    id: "turn_2_abc".into(),
                    hlc: Some(hlc(40, 0, "phone")),
                    created_at_ms: phone.created_at_ms,
                    updated_at_ms: phone.updated_at_ms,
                },
            ]
        );
        assert_eq!(
            serde_json::to_value(&summaries[0]).unwrap(),
            serde_json::json!({ "id": "1-1", "createdAtMs": 30 })
        );
        assert_eq!(read_note(directory, "turn_2_abc"), Some(phone));
    }

    fn sync_on(sync: &Path, device: &str) {
        fs::create_dir_all(sync.join("state")).unwrap();
        fs::write(
            sync.join("state").join("meta.json"),
            serde_json::json!({
                "v": 1,
                "deviceId": device,
                "clock": { "t": 0, "c": 0, "d": device },
            })
            .to_string(),
        )
        .unwrap();
    }

    fn synced_library(folder: &Path) -> Library {
        let captures = folder.join("captures");
        fs::create_dir_all(&captures).unwrap();
        Library {
            captures,
            sync: Some(folder.join("sync")),
        }
    }

    #[test]
    fn local_changes_are_stamped_while_sync_is_on() {
        let folder = tempfile::tempdir().unwrap();
        let notes = synced_library(folder.path());
        record(&notes.captures, "3-1", 5);
        // Sync off: an edit carries no version.
        update_record(&notes, "3-1", "first".into(), vec![], None).unwrap();
        let saved = read_record(&notes.captures, "3-1").unwrap();
        assert_eq!(saved.hlc, None);
        assert!(saved.updated_at_ms.is_some());

        sync_on(notes.sync.as_ref().unwrap(), "desk");
        update_record(&notes, "3-1", "second".into(), vec![], None).unwrap();
        let first = read_record(&notes.captures, "3-1").unwrap().hlc.unwrap();
        assert_eq!(first.d, "desk");
        assert!(first.t > 1_700_000_000_000);
        update_record(&notes, "3-1", "third".into(), vec![], None).unwrap();
        let second = read_record(&notes.captures, "3-1").unwrap().hlc.unwrap();
        assert_eq!(second.order(&first), std::cmp::Ordering::Greater);

        // A note stamped far ahead on another device: the edit still wins.
        let mut ahead = read_record(&notes.captures, "3-1").unwrap();
        ahead.hlc = Some(hlc(u64::from(u32::MAX) * 1_000, 4, "phone"));
        store(&notes.captures, &ahead).unwrap();
        update_record(&notes, "3-1", "fourth".into(), vec![], None).unwrap();
        assert_eq!(
            read_record(&notes.captures, "3-1").unwrap().hlc,
            Some(hlc(u64::from(u32::MAX) * 1_000, 5, "desk"))
        );
    }

    #[test]
    fn a_studio_save_keeps_a_version_that_sync_wrote_meanwhile() {
        let folder = tempfile::tempdir().unwrap();
        let notes = synced_library(folder.path());
        sync_on(notes.sync.as_ref().unwrap(), "desk");
        record(&notes.captures, "3-1", 5);
        let opened = update_record(&notes, "3-1", "opened".into(), vec![], None)
            .unwrap()
            .hlc;
        // Saving what the studio opened: no copy.
        let base = EditBase { hlc: opened };
        let saved = update_record(&notes, "3-1", "mine".into(), vec![], Some(&base)).unwrap();
        assert_eq!(saved.conflict_copy, None);
        // The phone edits the note while the studio still shows it.
        let mut remote = read_record(&notes.captures, "3-1").unwrap();
        let theirs = hlc(u64::from(u32::MAX) * 1_000, 0, "phone");
        remote.transcript = Some("edited on the phone".into());
        remote.hlc = Some(theirs.clone());
        store(&notes.captures, &remote).unwrap();
        let base = EditBase { hlc: saved.hlc };
        let saved =
            update_record(&notes, "3-1", "mine, again".into(), vec![], Some(&base)).unwrap();
        // The save is the note, newer than the phone's edit…
        let note = read_record(&notes.captures, "3-1").unwrap();
        assert_eq!(note.transcript.as_deref(), Some("mine, again"));
        assert_eq!(note.hlc, saved.hlc);
        assert_eq!(
            note.hlc.as_ref().unwrap().order(&theirs),
            std::cmp::Ordering::Greater
        );
        // …and the phone's edit is a conflict copy, named as the engine names it.
        let copy_id = saved.conflict_copy.unwrap();
        assert_eq!(copy_id, format!("3-1-c{}phon", base36(theirs.t)));
        let copy = read_record(&notes.captures, &copy_id).unwrap();
        assert_eq!(copy.transcript.as_deref(), Some("edited on the phone"));
        assert_eq!(copy.conflict_of.as_deref(), Some("3-1"));
        assert_eq!(
            copy.hlc.as_ref().unwrap().order(&theirs),
            std::cmp::Ordering::Greater
        );
        // Without a base (an editor that opened no saved version), as before.
        let saved = update_record(&notes, "3-1", "plain".into(), vec![], None).unwrap();
        assert_eq!(saved.conflict_copy, None);
    }

    #[test]
    fn a_text_edit_drops_the_refined_text_the_phone_would_show_instead() {
        let folder = tempfile::tempdir().unwrap();
        let notes = synced_library(folder.path());
        sync_on(notes.sync.as_ref().unwrap(), "desk");
        record(&notes.captures, "3-1", 5);
        let mut dictated = read_record(&notes.captures, "3-1").unwrap();
        dictated.transcript = Some("um buy milk".into());
        dictated.refined_text = Some("Buy milk.".into());
        dictated.segments = vec![segment(0, 900, "um buy milk", None)];
        store(&notes.captures, &dictated).unwrap();
        // Saving the same text (a speaker or a timing changed) keeps it.
        update_record(
            &notes,
            "3-1",
            "um buy milk".into(),
            vec![segment(0, 900, "um buy milk", Some("Ana"))],
            None,
        )
        .unwrap();
        let kept = read_record(&notes.captures, "3-1").unwrap();
        assert_eq!(kept.refined_text.as_deref(), Some("Buy milk."));
        // Editing the text: both apps now show the edit.
        update_record(&notes, "3-1", "Buy oat milk and eggs.".into(), vec![], None).unwrap();
        let edited = read_record(&notes.captures, "3-1").unwrap();
        assert_eq!(edited.transcript.as_deref(), Some("Buy oat milk and eggs."));
        assert_eq!(edited.refined_text, None);
    }

    #[test]
    fn a_save_that_changes_no_word_keeps_the_refined_text() {
        let folder = tempfile::tempdir().unwrap();
        let notes = synced_library(folder.path());
        sync_on(notes.sync.as_ref().unwrap(), "desk");
        // A phone dictation has no timings: the studio splits it into
        // sentences and sends them back joined with a blank line.
        record(&notes.captures, "3-1", 5);
        let mut dictated = read_record(&notes.captures, "3-1").unwrap();
        dictated.transcript = Some("Um so buy milk. Then call Ana about Friday.".into());
        dictated.refined_text = Some("Buy milk, then call Ana about Friday.".into());
        dictated.segments = vec![];
        store(&notes.captures, &dictated).unwrap();
        update_record(
            &notes,
            "3-1",
            "Um so buy milk.\n\nThen call Ana about Friday.".into(),
            vec![
                segment(0, 1_500, "Um so buy milk.", Some("Ana")),
                segment(1_500, 4_000, "Then call Ana about Friday.", None),
            ],
            None,
        )
        .unwrap();
        let kept = read_record(&notes.captures, "3-1").unwrap();
        assert_eq!(
            kept.refined_text.as_deref(),
            Some("Buy milk, then call Ana about Friday.")
        );
        assert_eq!(kept.segments[0].speaker.as_deref(), Some("Ana"));
        // A recording made here joins its segments with a space, the studio
        // with a blank line; the phone refined it meanwhile.
        record(&notes.captures, "3-2", 6);
        let mut recorded = read_record(&notes.captures, "3-2").unwrap();
        recorded.transcript = Some("so buy milk then call Ana".into());
        recorded.refined_text = Some("Buy milk, then call Ana.".into());
        recorded.segments = vec![
            segment(0, 900, "so buy milk", None),
            segment(1_000, 2_000, "then call Ana", None),
        ];
        store(&notes.captures, &recorded).unwrap();
        let named = vec![
            segment(0, 900, "so buy milk", Some("Sam")),
            segment(1_000, 2_000, "then call Ana", None),
        ];
        update_record(
            &notes,
            "3-2",
            "so buy milk\n\nthen call Ana".into(),
            named,
            None,
        )
        .unwrap();
        let kept = read_record(&notes.captures, "3-2").unwrap();
        assert_eq!(
            kept.refined_text.as_deref(),
            Some("Buy milk, then call Ana.")
        );
        // A word edited in one segment: the phone shows the edit.
        update_record(
            &notes,
            "3-2",
            "so buy oat milk\n\nthen call Ana".into(),
            vec![
                segment(0, 900, "so buy oat milk", Some("Sam")),
                segment(1_000, 2_000, "then call Ana", None),
            ],
            None,
        )
        .unwrap();
        let edited = read_record(&notes.captures, "3-2").unwrap();
        assert_eq!(
            edited.transcript.as_deref(),
            Some("so buy oat milk\n\nthen call Ana")
        );
        assert_eq!(edited.refined_text, None);
    }

    #[test]
    fn same_words_ignores_only_the_spacing() {
        assert!(same_words("a b. C d", "a b.\n\nC d"));
        assert!(same_words("  a\tb ", "a b"));
        assert!(same_words("", "  \n"));
        assert!(!same_words("a b", "a c"));
        assert!(!same_words("a b", "ab"));
        assert!(!same_words("a b", "a b."));
        assert!(!same_words("a b", "A b"));
        assert!(!same_words("a b", "b a"));
    }

    #[test]
    fn conflict_copy_ids_follow_sync_core() {
        // The ids sync-core's conflictCopyId gives for the same versions.
        assert_eq!(base36(0), "0");
        assert_eq!(base36(35), "z");
        assert_eq!(base36(36), "10");
        assert_eq!(
            conflict_copy_id("n1", &hlc(1_700_000_000_000, 0, "devA1")),
            "n1-cloyw3v28devA"
        );
        assert_eq!(conflict_copy_id("n1", &hlc(36, 2, "ab")), "n1-c10x2ab");
        let long = "x".repeat(64);
        assert_eq!(
            conflict_copy_id(&long, &hlc(1, 0, "dddd")),
            format!("{}-c1dddd", "x".repeat(57))
        );
    }

    #[test]
    fn a_studio_save_keeps_segment_fields_it_does_not_know() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        record(directory, "3-1", 5);
        let mut known = segment(0, 900, "Hello there.", None);
        known
            .extra
            .insert("confidence".into(), serde_json::json!(0.9));
        let mut moved = segment(900, 2000, "General Kenobi.", None);
        moved
            .extra
            .insert("words".into(), serde_json::json!([1, 2]));
        let mut saved = read_record(directory, "3-1").unwrap();
        saved.segments = vec![known, moved];
        store(directory, &saved).unwrap();
        update_record(
            &library(directory),
            "3-1",
            "Hello. General Kenobi.".into(),
            vec![
                segment(0, 900, "Hello.", Some("Obi-Wan")),
                segment(1000, 2000, "General Kenobi.", None),
            ],
            None,
        )
        .unwrap();
        let segments = read_record(directory, "3-1").unwrap().segments;
        assert_eq!(segments[0].text, "Hello.");
        assert_eq!(segments[0].speaker.as_deref(), Some("Obi-Wan"));
        assert_eq!(
            segments[0].extra.get("confidence"),
            Some(&serde_json::json!(0.9))
        );
        // Its timings changed: what was known of it no longer applies.
        assert!(segments[1].extra.is_empty());
    }

    #[test]
    fn segments_with_the_same_timings_keep_their_fields_in_order() {
        let known = |confidence: f64| {
            let mut known = segment(0, 900, "Hello.", None);
            known
                .extra
                .insert("confidence".into(), serde_json::json!(confidence));
            known
        };
        let saved = [known(0.9), segment(900, 1000, "Hi.", None), known(0.5)];
        let mut edited = vec![segment(0, 900, "Hello.", None); 3];
        keep_segment_extras(&saved, &mut edited);
        let confidence = |segment: &WhisperSegment| segment.extra.get("confidence").cloned();
        assert_eq!(confidence(&edited[0]), Some(serde_json::json!(0.9)));
        assert_eq!(confidence(&edited[1]), Some(serde_json::json!(0.5)));
        // Each saved segment is taken once.
        assert_eq!(confidence(&edited[2]), None);
    }

    #[test]
    fn a_retry_that_fails_gives_the_note_no_new_version() {
        let folder = tempfile::tempdir().unwrap();
        let notes = synced_library(folder.path());
        sync_on(notes.sync.as_ref().unwrap(), "desk");
        record(&notes.captures, "3-1", 5);
        let mut saved = read_record(&notes.captures, "3-1").unwrap();
        saved.hlc = Some(hlc(9, 0, "phone"));
        saved.updated_at_ms = Some(7);
        store(&notes.captures, &saved).unwrap();
        let missing = || unreachable!("the note is there");
        // Only the local error changes: same version, same date.
        let ((), changed) = notes
            .change("3-1", missing, |record| {
                record.error = Some("The model is missing.".into())
            })
            .unwrap()
            .unwrap();
        assert!(!changed);
        let failed = read_record(&notes.captures, "3-1").unwrap();
        assert_eq!(failed.error.as_deref(), Some("The model is missing."));
        assert_eq!(failed.hlc, Some(hlc(9, 0, "phone")));
        assert_eq!(failed.updated_at_ms, Some(7));
        // A new transcript is a change to sync.
        let ((), changed) = notes
            .change("3-1", missing, |record| {
                record.error = None;
                record.transcript = Some("transcribed again".into());
            })
            .unwrap()
            .unwrap();
        assert!(changed);
        let done = read_record(&notes.captures, "3-1").unwrap();
        assert_eq!(done.hlc.unwrap().d, "desk");
        assert_ne!(done.updated_at_ms, Some(7));
    }

    fn payload() -> crate::WhisperPayload {
        crate::WhisperPayload {
            audio_bytes: crate::streaming::wav_bytes(&[0; 1_600]),
            mime_type: "audio/wav".into(),
            duration_ms: 100,
            language: None,
            model_path: None,
        }
    }

    fn transcribed(text: &str) -> crate::WhisperResult {
        crate::WhisperResult {
            text: text.into(),
            segments: vec![segment(0, 100, text, None)],
            language: Some("en".into()),
            capture_id: None,
        }
    }

    #[test]
    fn a_note_deleted_while_it_is_transcribed_stays_deleted() {
        let folder = tempfile::tempdir().unwrap();
        let notes = synced_library(folder.path());
        let sync = notes.sync.clone().unwrap();
        sync_on(&sync, "desk");
        let saves = std::cell::Cell::new(0);
        let saved = || saves.set(saves.get() + 1);
        // Kept: saved before and after, and the answer names it.
        let done = notes
            .record_and_transcribe(
                payload(),
                Some("61-1".into()),
                |_| Ok(transcribed("kept")),
                saved,
            )
            .unwrap();
        assert_eq!(done.capture_id.as_deref(), Some("61-1"));
        assert_eq!(saves.get(), 2);
        let kept = read_record(&notes.captures, "61-1").unwrap();
        assert_eq!(kept.transcript.as_deref(), Some("kept"));
        assert_eq!(kept.error, None);
        assert_eq!(files_of(&notes.captures, "61-1"), ["61-1.json", "61-1.wav"]);

        // Deleted from the library while it is transcribed: the text is
        // still answered, but the note does not come back.
        saves.set(0);
        let done = notes
            .record_and_transcribe(
                payload(),
                Some("62-1".into()),
                |_| {
                    assert!(read_record(&notes.captures, "62-1").is_some());
                    notes.delete_by_user("62-1").unwrap();
                    Ok(transcribed("deleted meanwhile"))
                },
                saved,
            )
            .unwrap();
        assert_eq!(done.text, "deleted meanwhile");
        assert_eq!(done.capture_id, None);
        assert_eq!(saves.get(), 1);
        assert!(files_of(&notes.captures, "62-1").is_empty());
        // Its delete still reaches the other devices.
        let deletes: Value =
            serde_json::from_slice(&fs::read(sync.join("deletes.json")).unwrap()).unwrap();
        assert!(deletes["62-1"]["deletedAt"].is_object());

        // Nor does one whose transcription failed after the delete.
        let failed = notes.record_and_transcribe(
            payload(),
            Some("63-1".into()),
            |_| {
                notes.delete_by_user("63-1").unwrap();
                Err("The model is missing.".into())
            },
            || {},
        );
        assert_eq!(failed.unwrap_err(), "The model is missing.");
        assert!(files_of(&notes.captures, "63-1").is_empty());
    }

    #[test]
    fn a_retry_does_not_bring_back_a_note_deleted_meanwhile() {
        let folder = tempfile::tempdir().unwrap();
        let notes = synced_library(folder.path());
        sync_on(notes.sync.as_ref().unwrap(), "desk");
        record(&notes.captures, "64-1", 5);
        // The Retry began with the note there; the user deleted it since.
        let had_record = read_record(&notes.captures, "64-1").is_some();
        notes.delete_by_user("64-1").unwrap();
        let rebuilt = || (!had_record).then(Capture::default);
        let retried = notes
            .change("64-1", rebuilt, |record| {
                record.transcript = Some("transcribed again".into())
            })
            .unwrap();
        assert_eq!(retried, None);
        assert!(files_of(&notes.captures, "64-1").is_empty());
        // Audio whose record could not be read gets a new one.
        fs::write(notes.captures.join("65-1.wav"), b"RIFF").unwrap();
        let fresh = || {
            Some(Capture {
                id: "65-1".into(),
                ..Default::default()
            })
        };
        let ((), changed) = notes
            .change("65-1", fresh, |record| {
                record.transcript = Some("found".into())
            })
            .unwrap()
            .unwrap();
        assert!(changed);
        let found = read_record(&notes.captures, "65-1").unwrap();
        assert_eq!(found.transcript.as_deref(), Some("found"));
    }

    #[test]
    fn user_deletes_are_kept_for_sync_only_while_sync_is_on() {
        let folder = tempfile::tempdir().unwrap();
        let notes = synced_library(folder.path());
        let sync = notes.sync.clone().unwrap();
        record(&notes.captures, "1-1", 5);
        notes.delete_by_user("1-1").unwrap();
        assert!(!notes.captures.join("1-1.json").exists());
        assert!(!sync.join("deletes.json").exists());

        sync_on(&sync, "desk");
        record(&notes.captures, "2-1", 5);
        let mut saved = read_record(&notes.captures, "2-1").unwrap();
        saved.hlc = Some(hlc(9, 2, "desk"));
        store(&notes.captures, &saved).unwrap();
        // A synced note without audio is deleted the same way.
        notes
            .upsert_synced(synced("turn_3_x", "phone", hlc(4, 0, "phone")), None, None)
            .unwrap();
        notes.delete_by_user("2-1").unwrap();
        notes.delete_by_user("turn_3_x").unwrap();
        assert_eq!(fs::read_dir(&notes.captures).unwrap().count(), 0);
        let deletes: Value =
            serde_json::from_slice(&fs::read(sync.join("deletes.json")).unwrap()).unwrap();
        // Each keeps the note's version, and is stamped when the user deleted
        // it, however late the engine records it.
        let stamped =
            |id: &str| -> Hlc { serde_json::from_value(deletes[id]["deletedAt"].clone()).unwrap() };
        let (first, second) = (stamped("2-1"), stamped("turn_3_x"));
        assert_eq!(first.d, "desk");
        assert!(first.t > 1_700_000_000_000);
        assert_ne!(second.order(&first), std::cmp::Ordering::Less);
        assert_eq!(
            deletes,
            serde_json::json!({
                "2-1": { "hlc": { "t": 9, "c": 2, "d": "desk" }, "deletedAt": first },
                "turn_3_x": { "hlc": { "t": 4, "c": 0, "d": "phone" }, "deletedAt": second },
            })
        );
    }

    #[test]
    fn retention_keeps_pinned_notes() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        let day = 86_400_000;
        let now = 100 * day;
        let mut pinned = synced("turn_1_old", "pinned", hlc(1, 0, "phone"));
        pinned.created_at_ms = now - 40 * day;
        let mut unpinned = synced("turn_2_old", "not pinned", hlc(1, 0, "phone"));
        unpinned.created_at_ms = now - 40 * day;
        unpinned.pinned = None;
        store(directory, &pinned).unwrap();
        store(directory, &unpinned).unwrap();
        // Neither has audio: retention removes the record alone.
        assert_eq!(purge_directory(directory, Some(30), now).unwrap(), 1);
        assert!(directory.join("turn_1_old.json").exists());
        assert!(!directory.join("turn_2_old.json").exists());
        assert_eq!(purge_directory(directory, None, now).unwrap(), 1);
        assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
    }

    #[test]
    fn records_from_before_sync_are_saved_as_before() {
        let old = br#"{"id":"1-1","createdAtMs":1,"durationMs":2,"transcript":"hi","error":null,"language":"en","segments":[{"startMs":0,"endMs":10,"text":"hi","speaker":"A"}]}"#;
        let capture: Capture = serde_json::from_slice(old).unwrap();
        assert_eq!(capture.hlc, None);
        assert!(capture.extra.is_empty() && capture.segments[0].extra.is_empty());
        assert_eq!(serde_json::to_vec(&capture).unwrap(), old.to_vec());
    }
}
