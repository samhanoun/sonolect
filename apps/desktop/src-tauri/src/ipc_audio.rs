//! Binary audio over IPC.
//!
//! The web layer sends recordings as the raw request body with settings in
//! percent-encoded `x-sonolect-*` headers. The old JSON number array turned a
//! three-minute recording (5.8 MB) into about 20 MB of JSON to build and parse.
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request};

/// Largest accepted recording: three minutes of 16 kHz mono 16-bit WAV.
pub const MAX_AUDIO_BYTES: usize = 5_800_044;
/// Largest piece of a live recording: about a minute of 16 kHz mono PCM. The
/// web layer sends half-second pieces; the room is for a stalled queue.
pub const MAX_CHUNK_BYTES: usize = 2_000_000;

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3)?;
            if !hex.iter().all(u8::is_ascii_hexdigit) {
                return None;
            }
            decoded.push(u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

/// A non-empty, decoded `x-sonolect-*` header value.
pub fn header(request: &Request<'_>, name: &str) -> Option<String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(percent_decode)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn body_bytes(body: &InvokeBody, limit: usize) -> Result<Vec<u8>, String> {
    let bytes = match body {
        InvokeBody::Raw(bytes) => bytes.clone(),
        // The postMessage IPC fallback delivers binary bodies as number arrays.
        InvokeBody::Json(Value::Array(values)) => values
            .iter()
            .map(|value| value.as_u64().and_then(|n| u8::try_from(n).ok()))
            .collect::<Option<Vec<u8>>>()
            .ok_or("The recording was not sent as audio bytes.")?,
        InvokeBody::Json(_) => return Err("Send the recording as binary audio.".into()),
    };
    if bytes.is_empty() || bytes.len() > limit {
        return Err("Invalid recording size.".into());
    }
    Ok(bytes)
}

/// One piece of a live recording: the raw 16-bit PCM body of the request.
pub fn pcm_chunk(request: &Request<'_>) -> Result<Vec<u8>, String> {
    body_bytes(request.body(), MAX_CHUNK_BYTES)
}

/// Builds the engine payload from a binary IPC request.
pub fn whisper_payload(request: &Request<'_>) -> Result<super::WhisperPayload, String> {
    let audio_bytes = body_bytes(request.body(), MAX_AUDIO_BYTES)?;
    let duration_ms = header(request, "x-sonolect-duration-ms")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        // 16 kHz mono 16-bit PCM is 32 bytes per millisecond after the header.
        .unwrap_or_else(|| (audio_bytes.len().saturating_sub(44) / 32).max(1) as u64);
    Ok(super::WhisperPayload {
        audio_bytes,
        mime_type: "audio/wav".into(),
        duration_ms,
        language: header(request, "x-sonolect-language"),
        model_path: header(request, "x-sonolect-model-path"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_encoded_headers() {
        assert_eq!(
            percent_decode("C%3A%2FUsers%2FZo%C3%A9%2Fggml-base.bin").as_deref(),
            Some("C:/Users/Zoé/ggml-base.bin")
        );
        assert_eq!(percent_decode("fr-FR").as_deref(), Some("fr-FR"));
        for broken in ["%", "%4", "%zz", "%+1", "%C3"] {
            assert_eq!(percent_decode(broken), None, "{broken}");
        }
    }

    #[test]
    fn accepts_raw_bodies_and_the_number_array_fallback() {
        assert_eq!(
            body_bytes(&InvokeBody::Raw(vec![1, 2, 3]), MAX_AUDIO_BYTES).unwrap(),
            vec![1, 2, 3]
        );
        assert_eq!(
            body_bytes(
                &InvokeBody::Json(serde_json::json!([1, 2, 255])),
                MAX_AUDIO_BYTES
            )
            .unwrap(),
            vec![1, 2, 255]
        );
        assert!(body_bytes(
            &InvokeBody::Json(serde_json::json!([1, 256])),
            MAX_AUDIO_BYTES
        )
        .is_err());
        assert!(body_bytes(
            &InvokeBody::Json(serde_json::json!({"payload": 1})),
            MAX_AUDIO_BYTES
        )
        .is_err());
        assert!(body_bytes(&InvokeBody::Raw(vec![]), MAX_AUDIO_BYTES).is_err());
        assert!(body_bytes(
            &InvokeBody::Raw(vec![0; MAX_AUDIO_BYTES + 1]),
            MAX_AUDIO_BYTES
        )
        .is_err());
        assert!(body_bytes(&InvokeBody::Raw(vec![0; MAX_CHUNK_BYTES]), MAX_CHUNK_BYTES).is_ok());
        assert!(body_bytes(
            &InvokeBody::Raw(vec![0; MAX_CHUNK_BYTES + 1]),
            MAX_CHUNK_BYTES
        )
        .is_err());
    }
}
