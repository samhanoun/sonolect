use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![transcribe_audio])
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
}
