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
}
fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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
fn write_record(app: &tauri::AppHandle, capture: &Capture) -> Result<(), String> {
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
    let wav = directory(app)?.join(format!("{id}.wav"));
    fs::write(wav, &payload.audio_bytes).map_err(|e| format!("Cannot save recording: {e}"))?;
    let mut record = Capture {
        id,
        created_at_ms: now.as_millis() as u64,
        duration_ms: payload.duration_ms,
        transcript: None,
        error: Some("Processing was interrupted. Retry this recording.".into()),
        language: payload.language.clone(),
    };
    write_record(app, &record)?;
    let result = transcribe(payload);
    match &result {
        Ok(output) => {
            record.transcript = Some(output.text.clone());
            record.error = None;
            record.language = output.language.clone();
        }
        Err(error) => record.error = Some(error.clone()),
    }
    write_record(app, &record)?;
    result
}
#[tauri::command]
pub fn list_local_captures(app: tauri::AppHandle) -> Result<Vec<Capture>, String> {
    let mut captures = vec![];
    for entry in fs::read_dir(directory(&app)?).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(data) = fs::read(&path) {
            if let Ok(capture) = serde_json::from_slice::<Capture>(&data) {
                captures.push(capture);
            }
        }
    }
    captures.sort_by_key(|capture| std::cmp::Reverse(capture.created_at_ms));
    Ok(captures)
}
#[tauri::command]
pub fn delete_local_capture(app: tauri::AppHandle, id: String) -> Result<(), String> {
    valid_id(&id)?;
    for extension in ["wav", "json", "json.tmp"] {
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
                            for extension in ["wav", "json.tmp"] {
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
#[tauri::command]
pub async fn retry_local_capture(
    app: tauri::AppHandle,
    id: String,
    model_path: Option<String>,
    language: Option<String>,
) -> Result<super::WhisperResult, String> {
    valid_id(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes =
            fs::read(directory(&app)?.join(format!("{id}.wav"))).map_err(|e| e.to_string())?;
        let duration_ms = bytes.len().saturating_sub(44) as u64 * 1000 / 32000;
        process(
            &app,
            super::WhisperPayload {
                audio_bytes: bytes,
                mime_type: "audio/wav".into(),
                duration_ms,
                language,
                model_path,
            },
            Some(id),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::{purge_directory, Capture};
    use std::fs;

    fn record(directory: &std::path::Path, id: &str, created_at_ms: u64) {
        let capture = Capture {
            id: id.into(),
            created_at_ms,
            duration_ms: 1000,
            transcript: Some("hello".into()),
            error: None,
            language: None,
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
    fn rejects_paths_outside_capture_directory() {
        for value in ["../model", "", "C:\\model", "123/4", "1.json"] {
            assert!(super::valid_id(value).is_err());
        }
        assert!(super::valid_id("17889300001234-1000").is_ok());
    }
}
