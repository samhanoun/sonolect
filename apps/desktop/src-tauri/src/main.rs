use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;
mod audio_feed;
mod bubble;
mod compact_audio;
mod fbank;
mod insertion;
mod ipc_audio;
mod local_engine;
mod local_history;
mod model_download;
mod online;
mod resample;
mod speakers;
mod streaming;
mod sync;
mod system_audio;
#[cfg(target_os = "windows")]
mod system_loopback;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
struct WhisperPayload {
    audio_bytes: Vec<u8>,
    #[allow(dead_code)] // always WAV today; kept for providers that accept other containers
    mime_type: String,
    duration_ms: u64,
    language: Option<String>,
    model_path: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhisperSegment {
    start_ms: u64,
    end_ms: u64,
    text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    speaker: Option<String>,
    /// Fields a synced note's segment carries that this version does not
    /// know: kept as they are, so no device drops another's data.
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WhisperResult {
    text: String,
    segments: Vec<WhisperSegment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    /// The saved recording this transcript belongs to, so the editor can play
    /// its audio. Set by `local_history` once the recording is on disk.
    #[serde(skip_serializing_if = "Option::is_none")]
    capture_id: Option<String>,
}

/// The recording is the raw IPC body; settings come in `x-sonolect-*` headers.
#[tauri::command]
async fn transcribe_audio(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<WhisperResult, String> {
    let payload = ipc_audio::whisper_payload(&request)?;
    tauri::async_runtime::spawn_blocking(move || local_history::process(&app, payload, None))
        .await
        .map_err(|e| e.to_string())?
}

// ── Permission types and commands ─────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionResult {
    status: String,
    platform: String,
}

#[cfg(target_os = "macos")]
fn check_accessibility() -> PermissionResult {
    // On macOS, try a benign AppleScript "System Events" call to detect
    // whether accessibility access has been granted.  The command
    // `tell application "System Events" to get name of first process`
    // requires Accessibility privileges.
    let output = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to get name of first process")
        .output();
    let status = match output {
        Ok(ref o) if o.status.success() => "granted",
        _ => "not-determined",
    };
    PermissionResult {
        status: status.to_owned(),
        platform: "macos".to_owned(),
    }
}

#[cfg(target_os = "linux")]
fn check_accessibility() -> PermissionResult {
    PermissionResult {
        status: "granted".to_owned(),
        platform: "linux".to_owned(),
    }
}

#[cfg(target_os = "windows")]
fn check_accessibility() -> PermissionResult {
    PermissionResult {
        status: "granted".to_owned(),
        platform: "windows".to_owned(),
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn check_accessibility() -> PermissionResult {
    PermissionResult {
        status: "unsupported".to_owned(),
        platform: "unknown".to_owned(),
    }
}

#[tauri::command]
fn check_accessibility_permission() -> PermissionResult {
    check_accessibility()
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .output()
            .map_err(|error| format!("Failed to open Accessibility settings: {error}"))?;
    }
    // Linux and Windows: no-op — no special settings page needed.
    Ok(())
}

// ── Edge TTS command ─────────────────────────────────────────────────

/// Edge voices are a Microsoft online service, so this honours Local only like
/// every other online request, and returns the MP3 as a raw binary response.
#[tauri::command]
fn edge_tts_synthesize(
    app: tauri::AppHandle,
    text: String,
    voice: String,
    rate: f64,
) -> Result<tauri::ipc::Response, String> {
    if !online::cloud_enabled() {
        return Err(
            "Local only is enabled. Edge voices are an online service; choose cloud processing first."
                .to_owned(),
        );
    }
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 12000 {
        return Err("Enter between 1 and 12,000 characters to synthesize.".to_owned());
    }
    if voice.is_empty()
        || voice.len() > 80
        || !voice
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Choose a valid Edge voice name.".to_owned());
    }
    if !rate.is_finite() || !(0.25..=4.0).contains(&rate) {
        return Err("Choose a speaking rate between 0.25x and 4x.".to_owned());
    }
    // The app's cache folder belongs to this user. In the shared temp folder,
    // another account could plant a file or link at this predictable name
    // before edge-tts writes to it.
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("tts");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let out_path = directory.join(format!("speech-{}-{counter}.mp3", std::process::id()));
    let rate_str = if (rate - 1.0).abs() < 0.01 {
        "+0%".to_owned()
    } else if rate > 1.0 {
        format!("+{}%", ((rate - 1.0) * 100.0).round() as i32)
    } else {
        format!("-{}%", ((1.0 - rate) * 100.0).round() as i32)
    };
    // `--option=value` keeps text or rates that start with "-" from being read
    // as extra edge-tts options.
    let output = Command::new("edge-tts")
        .arg(format!("--voice={voice}"))
        .arg(format!("--rate={rate_str}"))
        .arg(format!("--text={trimmed}"))
        .arg("--write-media")
        .arg(&out_path)
        .output()
        .map_err(|e| format!("Failed to run edge-tts: {e}. Install with: pip install edge-tts"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let _ = fs::remove_file(&out_path);
        return Err(format!("edge-tts failed: {stderr}"));
    }
    let audio = fs::read(&out_path).map_err(|e| format!("Failed to read TTS output: {e}"));
    let _ = fs::remove_file(&out_path);
    Ok(tauri::ipc::Response::new(audio?))
}

fn main() {
    // A local diagnostic path exercises the exact production engine without UI automation.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--list-provider-models") {
        match online::discover_models(args.get(2).map(String::as_str).unwrap_or("openrouter")) {
            Ok(models) => println!(
                "{}",
                serde_json::to_string(&models).expect("serialize public models")
            ),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("--transcribe-file") {
        let result = (|| -> Result<WhisperResult, String> {
            let audio_path = args
                .get(2)
                .ok_or("Usage: --transcribe-file audio.wav model.bin [language]")?;
            let model_path = args.get(3).ok_or("Provide a Whisper model path")?;
            let audio_bytes = fs::read(audio_path).map_err(|e| e.to_string())?;
            local_engine::transcribe_with_model(
                PathBuf::from(model_path),
                WhisperPayload {
                    duration_ms: audio_bytes.len().saturating_sub(44) as u64 * 1000 / 32000,
                    audio_bytes,
                    mime_type: "audio/wav".into(),
                    model_path: Some(model_path.clone()),
                    language: args.get(4).cloned(),
                },
            )
        })();
        match result {
            Ok(output) => println!(
                "{}",
                serde_json::to_string(&output).expect("serialize transcript")
            ),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("--detect-speakers") {
        match speakers::cli(&args[2..]) {
            Ok(json) => println!("{json}"),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(bubble::init())
        .setup(|app| {
            local_engine::prewarm(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bubble::bubble_show,
            bubble::bubble_hide,
            bubble::bubble_open_main,
            bubble::bubble_restore_target,
            transcribe_audio,
            online::save_provider_key,
            online::provider_key_status,
            online::delete_provider_key,
            online::provider_models,
            online::set_online_enabled,
            online::provider_transcribe,
            online::provider_speak,
            online::provider_rewrite,
            local_engine::local_model_status,
            local_engine::download_local_model,
            speakers::speaker_model_status,
            speakers::download_speaker_model,
            speakers::detect_speakers,
            speakers::cancel_speaker_detection,
            local_history::list_local_captures,
            local_history::delete_local_capture,
            local_history::retry_local_capture,
            local_history::purge_local_captures,
            local_history::read_local_capture_audio,
            local_history::update_local_capture,
            local_history::compress_local_captures,
            local_history::list_sync_notes,
            local_history::read_sync_note,
            local_history::upsert_synced_capture,
            local_history::apply_remote_delete,
            sync::sync_config,
            sync::sync_key_status,
            sync::sync_key_create,
            sync::sync_key_import,
            sync::sync_key_load,
            sync::sync_key_forget,
            sync::sync_state_load,
            sync::sync_state_save,
            sync::sync_state_clear,
            sync::sync_pending_deletes,
            sync::sync_pending_deletes_done,
            sync::sync_request,
            streaming::capture_begin,
            streaming::capture_append,
            streaming::capture_finish,
            streaming::capture_cancel,
            insertion::insert_text_into_active_app,
            check_accessibility_permission,
            open_accessibility_settings,
            edge_tts_synthesize,
            system_audio::check_system_audio_available,
            system_audio::start_system_audio_capture,
            system_audio::stop_system_audio_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sonolect desktop app");
}
