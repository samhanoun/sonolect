use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
static CAPTURE_PROCESS: Mutex<Option<u32>> = Mutex::new(None);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhisperPayload {
    audio_bytes: Vec<u8>,
    mime_type: String,
    duration_ms: u64,
    language: Option<String>,
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
fn transcribe_audio(payload: WhisperPayload) -> Result<WhisperResult, String> {
    if payload.audio_bytes.is_empty() {
        return Err("Audio payload is empty".to_owned());
    }
    let audio_path = create_temp_audio_path(&payload.mime_type);
    fs::write(&audio_path, &payload.audio_bytes)
        .map_err(|error| format!("Failed to write temporary audio: {error}"))?;
    let audio_path_string = audio_path.to_string_lossy().to_string();
    let result = run_whisper_command(&payload, &audio_path_string);
    let _ = fs::remove_file(&audio_path);
    result
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

// ---------------------------------------------------------------------------
// System audio capture
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemAudioStatus {
    available: bool,
    method: String,
    setup_instructions: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureHandle {
    id: String,
    started_at: String,
    output_path: String,
    status: String,
}

#[cfg(target_os = "linux")]
fn detect_system_audio() -> SystemAudioStatus {
    let has_parecord = command_exists("parecord");
    let has_pactl = command_exists("pactl");
    if has_parecord && has_pactl {
        SystemAudioStatus {
            available: true,
            method: "pulseaudio-monitor".to_owned(),
            setup_instructions: "PulseAudio monitor source detected. Ready to capture system audio.".to_owned(),
        }
    } else {
        SystemAudioStatus {
            available: false,
            method: "none".to_owned(),
            setup_instructions: "Install PulseAudio (pulseaudio, parecord, pactl) to enable system audio capture. On Ubuntu/Debian: sudo apt install pulseaudio-utils".to_owned(),
        }
    }
}

#[cfg(target_os = "macos")]
fn detect_system_audio() -> SystemAudioStatus {
    // Check for BlackHole or similar virtual audio device via ffmpeg
    let has_ffmpeg = command_exists("ffmpeg");
    let has_sox = command_exists("sox");
    if has_ffmpeg {
        SystemAudioStatus {
            available: true,
            method: "avfoundation-blackhole".to_owned(),
            setup_instructions: "ffmpeg detected. Install BlackHole (https://github.com/ExistentialAudio/BlackHole) for virtual audio loopback, then select 'BlackHole 2ch' as the capture device.".to_owned(),
        }
    } else if has_sox {
        SystemAudioStatus {
            available: true,
            method: "sox-fallback".to_owned(),
            setup_instructions: "sox detected as fallback. For best results, install ffmpeg and BlackHole for virtual audio loopback.".to_owned(),
        }
    } else {
        SystemAudioStatus {
            available: false,
            method: "none".to_owned(),
            setup_instructions: "Install ffmpeg (brew install ffmpeg) and BlackHole (https://github.com/ExistentialAudio/BlackHole) for system audio capture on macOS.".to_owned(),
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_system_audio() -> SystemAudioStatus {
    let has_ffmpeg = command_exists("ffmpeg");
    if has_ffmpeg {
        SystemAudioStatus {
            available: true,
            method: "dshow-stereo-mix".to_owned(),
            setup_instructions: "ffmpeg detected. Enable 'Stereo Mix' in Windows Sound settings: right-click the speaker icon > Sounds > Recording tab > right-click > Show Disabled Devices > enable Stereo Mix.".to_owned(),
        }
    } else {
        SystemAudioStatus {
            available: false,
            method: "none".to_owned(),
            setup_instructions: "Install ffmpeg (https://ffmpeg.org/download.html) and enable Stereo Mix in Windows Sound settings to capture system audio.".to_owned(),
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn detect_system_audio() -> SystemAudioStatus {
    SystemAudioStatus {
        available: false,
        method: "none".to_owned(),
        setup_instructions: "System audio capture is not supported on this operating system.".to_owned(),
    }
}

#[cfg(target_os = "linux")]
fn spawn_capture_process(output_path: &str) -> Result<std::process::Child, String> {
    // Get default sink monitor source
    let sink_output = Command::new("pactl")
        .arg("get-default-sink")
        .output()
        .map_err(|e| format!("Failed to query default sink: {e}"))?;
    let sink_name = String::from_utf8_lossy(&sink_output.stdout).trim().to_owned();
    if sink_name.is_empty() {
        return Err("No default PulseAudio sink found".to_owned());
    }
    let monitor = format!("{sink_name}.monitor");
    Command::new("parecord")
        .arg(format!("--device={monitor}"))
        .arg("--file-format=wav")
        .arg(output_path)
        .spawn()
        .map_err(|e| format!("Failed to start parecord: {e}"))
}

#[cfg(target_os = "macos")]
fn spawn_capture_process(output_path: &str) -> Result<std::process::Child, String> {
    if command_exists("ffmpeg") {
        Command::new("ffmpeg")
            .args(["-f", "avfoundation", "-i", ":BlackHole 2ch", "-acodec", "pcm_s16le", "-y", output_path])
            .spawn()
            .map_err(|e| format!("Failed to start ffmpeg: {e}"))
    } else if command_exists("sox") {
        Command::new("sox")
            .args(["-d", output_path])
            .spawn()
            .map_err(|e| format!("Failed to start sox: {e}"))
    } else {
        Err("No audio capture tool found (ffmpeg or sox required)".to_owned())
    }
}

#[cfg(target_os = "windows")]
fn spawn_capture_process(output_path: &str) -> Result<std::process::Child, String> {
    Command::new("ffmpeg")
        .args(["-f", "dshow", "-i", "audio=Stereo Mix", "-acodec", "pcm_s16le", "-y", output_path])
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {e}"))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn spawn_capture_process(_output_path: &str) -> Result<std::process::Child, String> {
    Err("System audio capture is not supported on this platform".to_owned())
}

fn generate_capture_id() -> String {
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("capture-{}-{}", std::process::id(), counter)
}

fn now_iso() -> String {
    // Simple ISO-ish timestamp without chrono dependency
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", duration.as_secs())
}

#[tauri::command]
fn check_system_audio_available() -> SystemAudioStatus {
    detect_system_audio()
}

#[tauri::command]
fn start_system_audio_capture(output_path: String) -> Result<CaptureHandle, String> {
    // Check if already capturing
    {
        let guard = CAPTURE_PROCESS.lock().map_err(|e| format!("Lock error: {e}"))?;
        if guard.is_some() {
            return Err("A system audio capture is already in progress".to_owned());
        }
    }

    let status = detect_system_audio();
    if !status.available {
        return Err(format!("System audio not available: {}", status.setup_instructions));
    }

    let child = spawn_capture_process(&output_path)?;
    let pid = child.id();

    {
        let mut guard = CAPTURE_PROCESS.lock().map_err(|e| format!("Lock error: {e}"))?;
        *guard = Some(pid);
    }

    Ok(CaptureHandle {
        id: generate_capture_id(),
        started_at: now_iso(),
        output_path,
        status: "recording".to_owned(),
    })
}

#[tauri::command]
fn stop_system_audio_capture() -> Result<(), String> {
    let pid = {
        let mut guard = CAPTURE_PROCESS.lock().map_err(|e| format!("Lock error: {e}"))?;
        guard.take()
    };

    match pid {
        Some(pid) => {
            // Send SIGTERM on Unix, taskkill on Windows
            #[cfg(unix)]
            {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/F"])
                    .output();
            }
            Ok(())
        }
        None => Err("No active system audio capture to stop".to_owned()),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            transcribe_audio,
            insert_text_into_active_app,
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

    #[test]
    fn detect_system_audio_returns_valid_status() {
        let status = detect_system_audio();
        // On any platform the struct should be well-formed
        assert!(!status.method.is_empty());
        assert!(!status.setup_instructions.is_empty());
    }

    #[test]
    fn generate_capture_id_is_unique() {
        let a = generate_capture_id();
        let b = generate_capture_id();
        assert_ne!(a, b);
        assert!(a.starts_with("capture-"));
    }

    #[test]
    fn now_iso_returns_nonempty_timestamp() {
        let ts = now_iso();
        assert!(!ts.is_empty());
        assert!(ts.ends_with('Z'));
    }

    #[test]
    fn stop_capture_without_active_returns_error() {
        // Ensure no capture is running
        {
            let mut guard = CAPTURE_PROCESS.lock().unwrap();
            *guard = None;
        }
        let result = stop_system_audio_capture();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No active"));
    }
}
