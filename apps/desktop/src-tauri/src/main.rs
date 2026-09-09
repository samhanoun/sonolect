use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
mod local_engine;
mod local_history;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhisperPayload {
    audio_bytes: Vec<u8>,
    mime_type: String,
    duration_ms: u64,
    language: Option<String>,
    model_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WhisperSegment {
    start_ms: u64,
    end_ms: u64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    speaker: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WhisperResult {
    text: String,
    segments: Vec<WhisperSegment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawWhisperJson {
    text: Option<String>,
    segments: Option<Vec<RawWhisperSegment>>,
    language: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawWhisperSegment {
    #[serde(default, alias = "start_ms")]
    start_ms: Option<f64>,
    #[serde(default, alias = "end_ms")]
    end_ms: Option<f64>,
    #[serde(default)]
    start: Option<f64>,
    #[serde(default)]
    end: Option<f64>,
    text: String,
    #[serde(default)]
    speaker: Option<String>,
}

fn sanitize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    })
}

fn normalize_ms(value: Option<f64>, seconds_value: Option<f64>) -> u64 {
    let raw = value.or_else(|| seconds_value.map(|seconds| seconds * 1000.0));
    raw.unwrap_or(0.0).round().max(0.0) as u64
}

fn parse_whisper_output(stdout: &str) -> Result<WhisperResult, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err("Whisper command produced no transcript text".to_owned());
    }

    if let Ok(raw) = serde_json::from_str::<RawWhisperJson>(trimmed) {
        let segments: Vec<WhisperSegment> = raw
            .segments
            .unwrap_or_default()
            .into_iter()
            .filter_map(|segment| {
                let text = segment.text.trim().to_owned();
                if text.is_empty() {
                    return None;
                }
                let start_ms = normalize_ms(segment.start_ms, segment.start);
                let end_ms = normalize_ms(segment.end_ms, segment.end).max(start_ms + 1);
                Some(WhisperSegment {
                    start_ms,
                    end_ms,
                    text,
                    speaker: sanitize_optional(segment.speaker),
                })
            })
            .collect();
        let text = raw
            .text
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                segments
                    .iter()
                    .map(|segment| segment.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            });
        if text.is_empty() {
            return Err("Whisper JSON contained no transcript text".to_owned());
        }
        return Ok(WhisperResult {
            text,
            segments,
            language: sanitize_optional(raw.language),
        });
    }

    Ok(WhisperResult {
        text: trimmed.to_owned(),
        segments: Vec::new(),
        language: None,
    })
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    if mime_type.contains("wav") {
        "wav"
    } else if mime_type.contains("mp4") || mime_type.contains("m4a") {
        "m4a"
    } else if mime_type.contains("ogg") {
        "ogg"
    } else {
        "webm"
    }
}

fn create_temp_audio_path(mime_type: &str) -> PathBuf {
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "sonolect-whisper-{}-{}.{}",
        std::process::id(),
        counter,
        extension_for_mime(mime_type)
    ))
}

fn resolve_command_args(payload: &WhisperPayload, audio_path: &str) -> Result<Vec<String>, String> {
    let raw = std::env::var("SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS").map_err(|_| {
        "Set SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS to a JSON array for an offline Whisper command"
            .to_owned()
    })?;
    let args: Vec<String> = serde_json::from_str(&raw)
        .map_err(|error| format!("Invalid SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS: {error}"))?;
    if args.is_empty() || args[0].trim().is_empty() {
        return Err("Whisper command args must include an executable".to_owned());
    }
    let language = payload.language.as_deref().unwrap_or("auto");
    Ok(args
        .into_iter()
        .map(|arg| {
            arg.replace("{audioPath}", audio_path)
                .replace("{mimeType}", &payload.mime_type)
                .replace("{language}", language)
                .replace("{durationMs}", &payload.duration_ms.to_string())
        })
        .collect())
}

fn run_whisper_command(
    payload: &WhisperPayload,
    audio_path: &str,
) -> Result<WhisperResult, String> {
    let args = resolve_command_args(payload, audio_path)?;
    let (program, program_args) = args
        .split_first()
        .ok_or_else(|| "Whisper command args must include an executable".to_owned())?;
    let output = Command::new(program)
        .args(program_args)
        .output()
        .map_err(|error| format!("Failed to run Whisper command: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!("Whisper command failed: {detail}"));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_whisper_output(&stdout)
}

#[tauri::command]
async fn transcribe_audio(
    app: tauri::AppHandle,
    payload: WhisperPayload,
) -> Result<WhisperResult, String> {
    tauri::async_runtime::spawn_blocking(move || local_history::process(&app, payload, None))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct InsertionResult {
    ok: bool,
    method: String,
    status: String,
}

fn command_exists(program: &str) -> bool {
    Command::new(program)
        .arg("--version")
        .output()
        .map(|output| {
            output.status.success() || !output.stderr.is_empty() || !output.stdout.is_empty()
        })
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn run_native_insert(text: &str) -> Result<(), String> {
    let script = if command_exists("wl-copy") && command_exists("wtype") {
        "printf %s \"$SONOLECT_INSERT_TEXT\" | wl-copy && wtype -M ctrl v -m ctrl"
    } else if command_exists("xclip") && command_exists("xdotool") {
        "printf %s \"$SONOLECT_INSERT_TEXT\" | xclip -selection clipboard && xdotool key ctrl+v"
    } else if command_exists("xsel") && command_exists("xdotool") {
        "printf %s \"$SONOLECT_INSERT_TEXT\" | xsel --clipboard --input && xdotool key ctrl+v"
    } else {
        return Err(
            "Install wl-copy+wtype or xclip/xsel+xdotool for direct Linux insertion".to_owned(),
        );
    };
    let output = Command::new("sh")
        .arg("-c")
        .arg(script)
        .env("SONOLECT_INSERT_TEXT", text)
        .output()
        .map_err(|error| format!("Failed to run Linux insertion command: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

#[cfg(target_os = "macos")]
fn run_native_insert(text: &str) -> Result<(), String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg("set the clipboard to (system attribute \"SONOLECT_INSERT_TEXT\")")
        .arg("-e")
        .arg("tell application \"System Events\" to keystroke \"v\" using command down")
        .env("SONOLECT_INSERT_TEXT", text)
        .output()
        .map_err(|error| format!("Failed to run macOS insertion command: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

#[cfg(target_os = "windows")]
fn run_native_insert(text: &str) -> Result<(), String> {
    let script = "$text = $env:SONOLECT_INSERT_TEXT; Set-Clipboard -Value $text; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')";
    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(script)
        .env("SONOLECT_INSERT_TEXT", text)
        .output()
        .map_err(|error| format!("Failed to run Windows insertion command: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn run_native_insert(_text: &str) -> Result<(), String> {
    Err("Direct insertion is unsupported on this operating system".to_owned())
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

#[tauri::command]
fn insert_text_into_active_app(text: String) -> InsertionResult {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return InsertionResult {
            ok: false,
            method: "clipboard-fallback".to_owned(),
            status: "Nothing to insert yet.".to_owned(),
        };
    }
    match run_native_insert(trimmed) {
        Ok(()) => InsertionResult {
            ok: true,
            method: "native-insert".to_owned(),
            status: "Inserted polished dictation into the active app.".to_owned(),
        },
        Err(error) => InsertionResult {
            ok: false,
            method: "clipboard-fallback".to_owned(),
            status: format!("Native insertion unavailable: {error}"),
        },
    }
}

// ── Edge TTS command ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EdgeTtsPayload {
    text: String,
    voice: String,
    rate: f64,
}

#[tauri::command]
fn edge_tts_synthesize(payload: EdgeTtsPayload) -> Result<Vec<u8>, String> {
    let trimmed = payload.text.trim();
    if trimmed.is_empty() {
        return Err("No text to synthesize".to_owned());
    }
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let out_path = std::env::temp_dir().join(format!(
        "sonolect-tts-{}-{}.mp3",
        std::process::id(),
        counter
    ));
    let rate_str = if (payload.rate - 1.0).abs() < 0.01 {
        "+0%".to_owned()
    } else if payload.rate > 1.0 {
        format!("+{}%", ((payload.rate - 1.0) * 100.0).round() as i32)
    } else {
        format!("-{}%", ((1.0 - payload.rate) * 100.0).round() as i32)
    };
    let output = Command::new("edge-tts")
        .arg("--voice")
        .arg(&payload.voice)
        .arg("--rate")
        .arg(&rate_str)
        .arg("--text")
        .arg(trimmed)
        .arg("--write-media")
        .arg(out_path.to_string_lossy().as_ref())
        .output()
        .map_err(|e| format!("Failed to run edge-tts: {e}. Install with: pip install edge-tts"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let _ = fs::remove_file(&out_path);
        return Err(format!("edge-tts failed: {stderr}"));
    }
    let audio = fs::read(&out_path).map_err(|e| format!("Failed to read TTS output: {e}"))?;
    let _ = fs::remove_file(&out_path);
    Ok(audio)
}

// ── System audio capture commands ────────────────────────────────────

#[tauri::command]
fn check_system_audio_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        Command::new("pactl")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("system_profiler")
            .arg("SPAudioDataType")
            .output();
        output
            .map(|o| {
                let text = String::from_utf8_lossy(&o.stdout);
                text.to_lowercase().contains("blackhole")
            })
            .unwrap_or(false)
    }
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

#[tauri::command]
fn start_system_audio_capture(output_path: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let monitor = Command::new("pactl")
            .args(["list", "short", "sources"])
            .output()
            .map_err(|e| format!("pactl failed: {e}"))?;
        let sources = String::from_utf8_lossy(&monitor.stdout);
        let monitor_source = sources
            .lines()
            .find(|l| l.contains("monitor"))
            .and_then(|l| l.split_whitespace().nth(1))
            .ok_or_else(|| "No PulseAudio monitor source found".to_owned())?;
        Command::new("parec")
            .args([
                "--device",
                monitor_source,
                "--file-format=wav",
                &output_path,
            ])
            .spawn()
            .map_err(|e| format!("Failed to start parec: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("ffmpeg")
            .args([
                "-f",
                "avfoundation",
                "-i",
                ":BlackHole 2ch",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "44100",
                "-ac",
                "1",
                &output_path,
            ])
            .spawn()
            .map_err(|e| format!("Failed to start ffmpeg capture: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let _ = output_path;
        Err(
            "Windows WASAPI capture requires native integration — use Stereo Mix recording device"
                .to_owned(),
        )
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = output_path;
        Err("System audio capture is not supported on this platform".to_owned())
    }
}

#[tauri::command]
fn stop_system_audio_capture() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        Command::new("pkill")
            .arg("parec")
            .output()
            .map_err(|e| format!("Failed to stop parec: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("pkill")
            .arg("-f")
            .arg("ffmpeg.*avfoundation.*BlackHole")
            .output()
            .map_err(|e| format!("Failed to stop ffmpeg: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Err("Not supported on this platform".to_owned())
    }
}

fn main() {
    // A local diagnostic path exercises the exact production engine without UI automation.
    let args: Vec<String> = std::env::args().collect();
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
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            transcribe_audio,
            local_engine::local_model_status,
            local_engine::download_local_model,
            local_history::list_local_captures,
            local_history::delete_local_capture,
            local_history::retry_local_capture,
            insert_text_into_active_app,
            check_accessibility_permission,
            open_accessibility_settings,
            edge_tts_synthesize,
            check_system_audio_available,
            start_system_audio_capture,
            stop_system_audio_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sonolect desktop app");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn parses_whisper_json_with_segments_speakers_and_language() {
        let output = r#"{
          "text":" Bonjour Sonolect ",
          "language":"fr",
          "segments":[
            {"start":0.0,"end":1.25,"text":" Bonjour ","speaker":" Speaker 1 "},
            {"startMs":1250,"endMs":2500,"text":"Sonolect"}
          ]
        }"#;

        let result = parse_whisper_output(output).expect("json output should parse");

        assert_eq!(result.text, "Bonjour Sonolect");
        assert_eq!(result.language.as_deref(), Some("fr"));
        assert_eq!(result.segments.len(), 2);
        assert_eq!(result.segments[0].start_ms, 0);
        assert_eq!(result.segments[0].end_ms, 1250);
        assert_eq!(result.segments[0].speaker.as_deref(), Some("Speaker 1"));
        assert_eq!(result.segments[1].start_ms, 1250);
    }

    #[test]
    fn parses_plain_text_command_output() {
        let result = parse_whisper_output("  hello offline whisper  ").expect("plain text parses");

        assert_eq!(result.text, "hello offline whisper");
        assert!(result.segments.is_empty());
    }

    #[test]
    fn reports_empty_native_insertion_as_clipboard_fallback() {
        let result = insert_text_into_active_app("   ".to_owned());

        assert!(!result.ok);
        assert_eq!(result.method, "clipboard-fallback");
        assert_eq!(result.status, "Nothing to insert yet.");
    }

    #[test]
    fn resolves_offline_command_args_without_shell() {
        let old = env::var("SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS").ok();
        env::set_var(
            "SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS",
            r#"["whisper-cli","-f","{audioPath}","-l","{language}","--duration","{durationMs}"]"#,
        );
        let payload = WhisperPayload {
            model_path: None,
            audio_bytes: vec![1, 2, 3],
            mime_type: "audio/webm".to_owned(),
            duration_ms: 1200,
            language: Some("fr".to_owned()),
        };

        let args = resolve_command_args(&payload, "/tmp/capture.webm").expect("args resolve");

        assert_eq!(
            args,
            vec![
                "whisper-cli",
                "-f",
                "/tmp/capture.webm",
                "-l",
                "fr",
                "--duration",
                "1200"
            ]
        );
        if let Some(value) = old {
            env::set_var("SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS", value);
        } else {
            env::remove_var("SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS");
        }
    }
}
