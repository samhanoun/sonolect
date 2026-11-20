//! Durable local recordings: write audio before inference; retain errors for retry.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

#[derive(Serialize, Deserialize)]
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
fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 40 || !id.bytes().all(|b| b.is_ascii_digit() || b == b'-') {
        return Err("Invalid recording ID.".into());
    }
    Ok(())
}
pub(super) fn write_record(app: &tauri::AppHandle, capture: &Capture) -> Result<(), String> {
    let directory = directory(app)?;
    let path = directory.join(format!("{}.json", capture.id));
    let temp = directory.join(format!("{}.json.tmp", capture.id));
    fs::write(
        &temp,
        serde_json::to_vec(capture).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Rename replaces atomically on supported desktop filesystems.
    fs::rename(temp, path).map_err(|e| e.to_string())
}
/// The saved record of one recording, when it exists and can be read.
pub(super) fn read_record(directory: &std::path::Path, id: &str) -> Option<Capture> {
    let data = fs::read(directory.join(format!("{id}.json"))).ok()?;
    serde_json::from_slice(&data).ok()
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
    if payload.audio_bytes.is_empty() || payload.audio_bytes.len() > 5_800_044 {
        return Err("Invalid recording size.".into());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let id = id.unwrap_or_else(|| format!("{}-{}", now.as_nanos(), std::process::id()));
    valid_id(&id)?;
    let _hold = super::compact_audio::hold(&id);
    let wav = directory(app)?.join(format!("{id}.wav"));
    fs::write(wav, &payload.audio_bytes).map_err(|e| format!("Cannot save recording: {e}"))?;
    let mut record = Capture {
        id,
        created_at_ms: now.as_millis() as u64,
        duration_ms: payload.duration_ms,
        transcript: None,
        error: Some("Processing was interrupted. Retry this recording.".into()),
        language: payload.language.clone(),
        segments: vec![],
    };
    write_record(app, &record)?;
    let mut result = transcribe(payload);
    match &mut result {
        Ok(output) => {
            output.capture_id = Some(record.id.clone());
            record.transcript = Some(output.text.clone());
            record.error = None;
            record.language = output.language.clone();
            record.segments = output.segments.clone();
        }
        Err(error) => record.error = Some(error.clone()),
    }
    write_record(app, &record)?;
    result
}
#[tauri::command]
pub fn list_local_captures(app: tauri::AppHandle) -> Result<Vec<Capture>, String> {
    let mut captures = vec![];
    // The recording in progress joins the library once it is finished.
    let live = super::streaming::live_id();
    for entry in fs::read_dir(directory(&app)?).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(data) = fs::read(&path) {
            if let Ok(capture) = serde_json::from_slice::<Capture>(&data) {
                if live.as_deref() != Some(capture.id.as_str()) {
                    captures.push(capture);
                }
            }
        }
    }
    captures.sort_by_key(|capture| std::cmp::Reverse(capture.created_at_ms));
    Ok(captures)
}
/// The saved audio of one recording, as a raw binary response, so the studio
/// can play it back and jump to a segment.
#[tauri::command]
pub async fn read_local_capture_audio(
    app: tauri::AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    valid_id(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        super::compact_audio::read_as_wav(&directory(&app)?, &id).map(tauri::ipc::Response::new)
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

fn update_record(
    directory: &std::path::Path,
    id: &str,
    transcript: String,
    segments: Vec<super::WhisperSegment>,
) -> Result<(), String> {
    let (transcript, segments) = validated_edit(transcript, segments)?;
    let path = directory.join(format!("{id}.json"));
    let mut record = fs::read(&path)
        .ok()
        .and_then(|data| serde_json::from_slice::<Capture>(&data).ok())
        .ok_or("This recording is no longer in your library.")?;
    record.transcript = Some(transcript);
    record.segments = segments;
    let temp = directory.join(format!("{id}.json.tmp"));
    fs::write(
        &temp,
        serde_json::to_vec(&record).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}

/// Saves the transcript and segments edited in the studio back to a recording.
#[tauri::command]
pub fn update_local_capture(
    app: tauri::AppHandle,
    id: String,
    transcript: String,
    segments: Vec<super::WhisperSegment>,
) -> Result<(), String> {
    valid_id(&id)?;
    update_record(&directory(&app)?, &id, transcript, segments)
}
#[tauri::command]
pub fn delete_local_capture(app: tauri::AppHandle, id: String) -> Result<(), String> {
    valid_id(&id)?;
    for extension in ["wav", "opus", "opus.tmp", "json", "json.tmp"] {
        let path = directory(&app)?.join(format!("{id}.{extension}"));
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
/// Deletes saved recordings and transcripts from this device: every capture
/// when `older_than_days` is `None` ("Delete all my data"), otherwise those
/// recorded more than that many days ago (the retention setting). Returns how
/// many recordings were removed.
#[tauri::command]
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
                        .map(|capture| capture.created_at_ms);
                    match created {
                        Some(created) if created < cutoff_ms => {
                            for extension in ["wav", "opus", "opus.tmp", "json.tmp"] {
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
        super::streaming::retranscribe(&app, &id, model_path, language)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::{purge_directory, update_record, Capture};
    use crate::WhisperSegment;
    use std::fs;

    fn record(directory: &std::path::Path, id: &str, created_at_ms: u64) {
        let capture = Capture {
            id: id.into(),
            created_at_ms,
            duration_ms: 1000,
            transcript: Some("hello".into()),
            error: None,
            language: None,
            segments: vec![],
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
        let directory = std::env::temp_dir().join(format!("sonolect-purge-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let day = 86_400_000;
        let now = 100 * day;
        record(&directory, "1-1", now - 40 * day);
        record(&directory, "2-1", now - 2 * day);
        fs::write(directory.join("notes.txt"), b"keep").unwrap();

        assert_eq!(purge_directory(&directory, Some(30), now).unwrap(), 1);
        assert!(!directory.join("1-1.json").exists());
        assert!(!directory.join("1-1.wav").exists());
        assert!(directory.join("2-1.json").exists());
        assert!(directory.join("2-1.wav").exists());

        assert_eq!(purge_directory(&directory, None, now).unwrap(), 1);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        fs::remove_dir_all(&directory).unwrap();
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

    fn segment(start_ms: u64, end_ms: u64, text: &str, speaker: Option<&str>) -> WhisperSegment {
        WhisperSegment {
            start_ms,
            end_ms,
            text: text.into(),
            speaker: speaker.map(str::to_owned),
        }
    }

    #[test]
    fn edits_are_saved_with_their_segments_and_speakers() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        record(directory, "3-1", 5);

        update_record(
            directory,
            "3-1",
            "Hello there. General Kenobi.".into(),
            vec![
                segment(0, 900, "Hello there.", Some("  Obi-Wan ")),
                segment(900, 2000, "General Kenobi.", Some(" ")),
            ],
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
            update_record(directory, "9-9", "text".into(), vec![]).unwrap_err(),
            "This recording is no longer in your library."
        );
        assert_eq!(
            update_record(directory, "4-1", "x".repeat(2_000_001), vec![]).unwrap_err(),
            "The edited transcript is too large to save."
        );
        assert_eq!(
            update_record(
                directory,
                "4-1",
                "text".into(),
                vec![segment(500, 100, "text", None)]
            )
            .unwrap_err(),
            "A segment ends before it starts."
        );
        assert_eq!(
            update_record(
                directory,
                "4-1",
                "text".into(),
                vec![segment(0, 100, "text", Some(&"n".repeat(81)))]
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
}
