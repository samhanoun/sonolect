use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Read,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

static CLOUD_ENABLED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
    pub capabilities: Vec<String>,
    pub voices: Vec<String>,
}

fn provider_ok(provider: &str) -> Result<(), String> {
    if matches!(provider, "openrouter" | "opencode") {
        Ok(())
    } else {
        Err("Unknown model provider.".into())
    }
}
fn guard_cloud(enabled: bool) -> Result<(), String> {
    if enabled {
        Ok(())
    } else {
        Err(
            "Local only is enabled. Choose cloud processing before sending audio or text online."
                .into(),
        )
    }
}
fn validate_key(key: &str) -> Result<String, String> {
    let key = key.trim();
    if key.len() < 8 || key.len() > 1024 || !key.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("Enter a valid API key without spaces or line breaks.".into());
    }
    Ok(key.into())
}
fn model_ok(model: &str) -> Result<(), String> {
    if model.is_empty()
        || model.len() > 200
        || !model
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/_.:-".contains(&b))
        || model.contains("..")
    {
        Err("Choose a valid model from the catalog.".into())
    } else {
        Ok(())
    }
}
fn speech_endpoint(provider: &str, task: &str) -> Result<&'static str, String> {
    provider_ok(provider)?;
    match (provider, task) {
        ("openrouter", "stt") => Ok("https://openrouter.ai/api/v1/audio/transcriptions"),
        ("openrouter", "tts") => Ok("https://openrouter.ai/api/v1/audio/speech"),
        _ => Err("OpenCode Zen does not advertise a dedicated speech API. Use OpenRouter for online speech, or local Whisper for transcription.".into()),
    }
}
fn parse_models(provider: &str, payload: &Value) -> Result<Vec<ProviderModel>, String> {
    provider_ok(provider)?;
    let entries = payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or("The provider returned an invalid model catalog.")?;
    Ok(entries
        .iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?;
            if model_ok(id).is_err() {
                return None;
            }
            let output = entry
                .pointer("/architecture/output_modalities")
                .and_then(Value::as_array);
            let mut capabilities = vec![];
            if provider == "opencode" {
                capabilities.push("text".into());
            } else if let Some(output) = output {
                for (modality, task) in [
                    ("transcription", "stt"),
                    ("speech", "tts"),
                    ("text", "text"),
                ] {
                    if output.iter().any(|v| v.as_str() == Some(modality)) {
                        capabilities.push(task.into());
                    }
                }
            }
            if capabilities.is_empty() {
                return None;
            }
            let voices = entry
                .get("supported_voices")
                .and_then(Value::as_array)
                .map(|v| {
                    v.iter()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            Some(ProviderModel {
                id: id.into(),
                name: entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .chars()
                    .take(200)
                    .collect(),
                capabilities,
                voices,
            })
        })
        .collect())
}
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize the provider connection.".into())
}
fn response_bytes(response: reqwest::blocking::Response) -> Result<Vec<u8>, String> {
    let code = response.status().as_u16();
    if !(200..300).contains(&code) {
        return Err(match code {
            401 | 403 => "The provider rejected this API key or model permission.",
            402 => "The provider account needs credits.",
            429 => "The provider is rate-limiting requests. Try again later.",
            400 | 404 => "The model or voice is unavailable, or does not support these options. Refresh the catalog and check the selection.",
            _ => "The provider request failed. Check the connection and try again.",
        }.into());
    }
    let mut bytes = vec![];
    response
        .take(25 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The provider response was interrupted.")?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("The provider response exceeded the size limit.".into());
    }
    Ok(bytes)
}
#[cfg(target_os = "windows")]
fn entry(provider: &str) -> Result<keyring::Entry, String> {
    provider_ok(provider)?;
    keyring::Entry::new("com.sonolect.local.providers", provider)
        .map_err(|_| "Windows Credential Manager is unavailable.".into())
}
#[cfg(target_os = "windows")]
fn read_key(provider: &str) -> Result<String, String> {
    entry(provider)?
        .get_password()
        .map_err(|_| "Save this provider's API key in Models & voices first.".into())
}
#[cfg(not(target_os = "windows"))]
fn read_key(_provider: &str) -> Result<String, String> {
    Err("Secure API key storage is currently supported on Windows.".into())
}

#[tauri::command]
pub fn save_provider_key(provider: String, key: String) -> Result<(), String> {
    provider_ok(&provider)?;
    let key = validate_key(&key)?;
    #[cfg(target_os = "windows")]
    {
        entry(&provider)?
            .set_password(&key)
            .map_err(|_| "Could not save the key to Windows Credential Manager.".into())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = key;
        Err("Secure key storage requires Windows.".into())
    }
}
#[tauri::command]
pub fn provider_key_status(provider: String) -> Result<bool, String> {
    provider_ok(&provider)?;
    #[cfg(target_os = "windows")]
    {
        match entry(&provider)?.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err("Could not read Windows Credential Manager.".into()),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}
#[tauri::command]
pub fn delete_provider_key(provider: String) -> Result<(), String> {
    provider_ok(&provider)?;
    #[cfg(target_os = "windows")]
    {
        match entry(&provider)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not delete the saved key.".into()),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Secure key storage requires Windows.".into())
    }
}
#[tauri::command]
pub fn set_online_enabled(enabled: bool) {
    CLOUD_ENABLED.store(enabled, Ordering::SeqCst);
}
#[tauri::command]
pub async fn provider_models(provider: String) -> Result<Vec<ProviderModel>, String> {
    provider_ok(&provider)?;
    tauri::async_runtime::spawn_blocking(move || discover_models(&provider))
        .await
        .map_err(|_| "Model discovery was interrupted.".to_string())?
}
pub fn discover_models(provider: &str) -> Result<Vec<ProviderModel>, String> {
    provider_ok(provider)?;
    // Dedicated speech models are absent from OpenRouter's default text-model catalog.
    let urls = if provider == "openrouter" {
        vec![
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/api/v1/models?output_modalities=transcription",
            "https://openrouter.ai/api/v1/models?output_modalities=speech",
        ]
    } else {
        vec!["https://opencode.ai/inference/v1/models"]
    };
    let client = client()?;
    let mut models = std::collections::BTreeMap::new();
    for url in urls {
        // Public discovery never sends the saved API key, audio, or text.
        let bytes = response_bytes(
            client
                .get(url)
                .send()
                .map_err(|_| "Could not load models. Check your internet connection.")?,
        )?;
        for model in parse_models(
            provider,
            &serde_json::from_slice(&bytes).map_err(|_| "Invalid model catalog JSON.")?,
        )? {
            models.insert(model.id.clone(), model);
        }
    }
    Ok(models.into_values().collect())
}
fn transcription_body(model: &str, audio: &[u8], language: Option<&str>) -> Value {
    let mut body =
        json!({"model":model,"input_audio":{"data":STANDARD.encode(audio),"format":"wav"}});
    if let Some(language) = language.filter(|l| !l.is_empty() && *l != "auto") {
        body["language"] = json!(language.split('-').next().unwrap_or(language));
    }
    body
}
fn post_json(
    provider: &str,
    endpoint: &str,
    body: &Value,
) -> Result<reqwest::blocking::Response, String> {
    guard_cloud(CLOUD_ENABLED.load(Ordering::SeqCst))?;
    let key = read_key(provider)?;
    let mut request = client()?.post(endpoint).bearer_auth(&key).json(body);
    if provider == "opencode" && endpoint.ends_with("/messages") {
        request = request
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01");
    }
    if provider == "opencode" && endpoint.contains(":generateContent") {
        request = request.header("x-goog-api-key", &key);
    }
    guard_cloud(CLOUD_ENABLED.load(Ordering::SeqCst))?;
    request
        .send()
        .map_err(|_| "The provider connection failed or timed out.".into())
}
#[tauri::command]
pub async fn provider_transcribe(
    app: tauri::AppHandle,
    provider: String,
    model: String,
    payload: super::WhisperPayload,
) -> Result<super::WhisperResult, String> {
    let endpoint = speech_endpoint(&provider, "stt")?;
    model_ok(&model)?;
    guard_cloud(CLOUD_ENABLED.load(Ordering::SeqCst))?;
    tauri::async_runtime::spawn_blocking(move || {
        super::local_history::process_with(&app, payload, None, |payload| {
            let body =
                transcription_body(&model, &payload.audio_bytes, payload.language.as_deref());
            let bytes = response_bytes(post_json(&provider, endpoint, &body)?)?;
            let response: Value =
                serde_json::from_slice(&bytes).map_err(|_| "Invalid transcription response.")?;
            let text = response
                .get("text")
                .and_then(Value::as_str)
                .ok_or("The provider returned no transcript field.")?
                .to_owned();
            Ok(super::WhisperResult {
                text,
                segments: vec![],
                language: payload.language,
            })
        })
    })
    .await
    .map_err(|_| "Online transcription was interrupted.".to_string())?
}
#[tauri::command]
pub async fn provider_speak(
    provider: String,
    model: String,
    text: String,
    voice: String,
    response_format: Option<String>,
    sample_rate: Option<u32>,
) -> Result<SpeechAudio, String> {
    let endpoint = speech_endpoint(&provider, "tts")?;
    model_ok(&model)?;
    guard_cloud(CLOUD_ENABLED.load(Ordering::SeqCst))?;
    if text.trim().is_empty() || text.chars().count() > 12000 || voice.len() > 200 {
        return Err("Enter between 1 and 12,000 characters and a valid voice.".into());
    }
    let format = response_format.unwrap_or_else(|| "mp3".into());
    if !matches!(format.as_str(), "mp3" | "pcm") { return Err("Choose MP3 or PCM output.".into()); }
    let rate = sample_rate.unwrap_or(24000);
    if ![16000, 22050, 24000, 44100, 48000].contains(&rate) { return Err("Unsupported PCM sample rate.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let mut body = json!({"model":model,"input":text,"response_format":format});
        if !voice.trim().is_empty() {
            body["voice"] = json!(voice.trim());
        }
        let response = post_json(&provider, endpoint, &body)?;
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let bytes = response_bytes(response)?;
        if bytes.is_empty() { return Err("The provider returned empty audio.".into()); }
        if format == "pcm" && (content_type.starts_with("audio/pcm") || content_type.starts_with("application/octet-stream")) {
            Ok(SpeechAudio { bytes: wav_from_pcm(&bytes, rate)?, mime_type: "audio/wav".into() })
        } else if format == "mp3" && (content_type.starts_with("audio/mpeg") || content_type.starts_with("audio/mp3") || content_type.starts_with("application/octet-stream")) {
            Ok(SpeechAudio { bytes, mime_type: "audio/mpeg".into() })
        } else { Err("The provider returned an unexpected audio format. Check the model's format settings.".into()) }
    })
    .await
    .map_err(|_| "Speech generation was interrupted.".to_string())?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAudio { bytes: Vec<u8>, mime_type: String }
fn wav_from_pcm(bytes: &[u8], sample_rate: u32) -> Result<Vec<u8>, String> {
    if bytes.is_empty() || bytes.len() % 2 != 0 || ![16000,22050,24000,44100,48000].contains(&sample_rate) { return Err("Invalid 16-bit mono PCM audio or sample rate.".into()); }
    let mut output = std::io::Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut output, hound::WavSpec { channels: 1, sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int }).map_err(|e|e.to_string())?;
        for sample in bytes.chunks_exact(2) { writer.write_sample(i16::from_le_bytes([sample[0],sample[1]])).map_err(|e|e.to_string())?; }
        writer.finalize().map_err(|e|e.to_string())?;
    }
    Ok(output.into_inner())
}
fn text_endpoint(provider: &str, model: &str) -> Result<String, String> {
    provider_ok(provider)?; model_ok(model)?;
    if provider == "openrouter" { return Ok("https://openrouter.ai/api/v1/chat/completions".into()); }
    let path = if model.starts_with("gpt-") || model.starts_with("grok-") || model.starts_with("muse-") { "openai/v1/responses".to_owned() }
        else if model.starts_with("claude-") || model.starts_with("qwen") { "anthropic/v1/messages".into() }
        else if model.starts_with("gemini-") { format!("google/v1beta/models/{model}:generateContent") }
        else { "openai/v1/chat/completions".into() };
    Ok(format!("https://opencode.ai/inference/{path}"))
}
#[tauri::command]
pub async fn provider_rewrite(
    provider: String,
    model: String,
    text: String,
    instruction: String,
) -> Result<String, String> {
    provider_ok(&provider)?;
    model_ok(&model)?;
    guard_cloud(CLOUD_ENABLED.load(Ordering::SeqCst))?;
    if text.trim().is_empty() || text.chars().count() > 12000 || instruction.chars().count() > 1000
    {
        return Err("Enter up to 12,000 characters and a short editing instruction.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = format!("Edit the following text according to this request: {instruction}\nPreserve facts and names. Return only the resulting text.\n\nText:\n{text}");
        let url = text_endpoint(&provider, &model)?;
        let body = if url.ends_with("/responses") { json!({"model":model,"input":prompt}) }
            else if url.ends_with("/messages") { json!({"model":model,"max_tokens":4096,"messages":[{"role":"user","content":prompt}]}) }
            else if url.ends_with(":generateContent") { json!({"contents":[{"role":"user","parts":[{"text":prompt}]}]}) }
            else { json!({"model":model,"messages":[{"role":"user","content":prompt}]}) };
        let bytes = response_bytes(post_json(&provider, &url, &body)?)?;
        let response: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid text response.")?;
        let result = response.pointer("/choices/0/message/content").and_then(Value::as_str).map(str::to_owned)
            .or_else(|| response.get("output_text").and_then(Value::as_str).map(str::to_owned))
            .or_else(|| response.get("content").and_then(Value::as_array).map(|parts| parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<String>()))
            .or_else(|| response.pointer("/candidates/0/content/parts").and_then(Value::as_array).map(|parts| parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<String>()))
            .or_else(|| response.get("output").and_then(Value::as_array).map(|items| items.iter().filter_map(|i| i.get("content").and_then(Value::as_array)).flatten().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<String>()));
        result.filter(|r| !r.trim().is_empty()).ok_or("The model returned no editable text.".into())
    }).await.map_err(|_| "Text editing was interrupted.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn current_opencode_endpoints_and_pcm_playback() {
        assert_eq!(text_endpoint("opencode", "gpt-6.1-sol").unwrap(), "https://opencode.ai/inference/openai/v1/responses");
        assert_eq!(text_endpoint("opencode", "claude-sonnet-5-5").unwrap(), "https://opencode.ai/inference/anthropic/v1/messages");
        assert_eq!(text_endpoint("opencode", "gemini-4-argon").unwrap(), "https://opencode.ai/inference/google/v1beta/models/gemini-4-argon:generateContent");
        let wav = wav_from_pcm(&[0, 0, 255, 127], 24000).unwrap();
        let mut reader = hound::WavReader::new(std::io::Cursor::new(wav)).unwrap();
        assert_eq!(reader.spec().sample_rate, 24000);
        assert_eq!(reader.samples::<i16>().collect::<Result<Vec<_>,_>>().unwrap(), vec![0, 32767]);
        assert!(wav_from_pcm(&[0], 24000).is_err());
        assert!(wav_from_pcm(&[0,0], 0).is_err());
    }

    #[test]
    fn speech_endpoints_are_fixed_and_zen_speech_is_rejected() {
        assert_eq!(
            speech_endpoint("openrouter", "stt").unwrap(),
            "https://openrouter.ai/api/v1/audio/transcriptions"
        );
        assert_eq!(
            speech_endpoint("openrouter", "tts").unwrap(),
            "https://openrouter.ai/api/v1/audio/speech"
        );
        assert!(speech_endpoint("opencode", "stt").is_err());
        assert!(speech_endpoint("https://example.test", "tts").is_err());
    }

    #[test]
    fn catalogs_only_offer_declared_speech_capabilities() {
        let models = parse_models("openrouter", &json!({"data":[
            {"id":"vendor/stt","name":"Recognizer","architecture":{"output_modalities":["transcription"]}},
            {"id":"vendor/tts","architecture":{"output_modalities":["speech"]},"supported_voices":["voice-a"]},
            {"id":"vendor/chat","architecture":{"output_modalities":["text"]}},
            {"id":null}, {"id":"unknown/no-metadata"}
        ]})).unwrap();
        assert_eq!(models.len(), 3);
        assert_eq!(models[0].capabilities, vec!["stt"]);
        assert_eq!(models[1].voices, vec!["voice-a"]);
        assert_eq!(models[2].capabilities, vec!["text"]);
    }

    #[test]
    fn zen_catalog_is_never_misrepresented_as_speech() {
        let models = parse_models("opencode", &json!({"data":[{"id":"gpt-5"}]})).unwrap();
        assert_eq!(models[0].capabilities, vec!["text"]);
    }

    #[test]
    fn local_policy_and_invalid_credentials_fail_closed() {
        assert!(guard_cloud(false).is_err());
        assert!(guard_cloud(true).is_ok());
        for key in ["", "key\nvalue", "key with spaces"] {
            assert!(validate_key(key).is_err());
        }
        assert_eq!(validate_key(" valid-test-key ").unwrap(), "valid-test-key");
    }

    #[test]
    fn transcription_uses_json_base64_and_omits_auto_language() {
        let body = transcription_body("vendor/stt", &[0, 1, 2], Some("auto"));
        assert_eq!(body["input_audio"]["data"], "AAEC");
        assert_eq!(body["input_audio"]["format"], "wav");
        assert!(body.get("language").is_none());
        assert_eq!(
            transcription_body("vendor/stt", &[1], Some("fr-FR"))["language"],
            "fr"
        );
    }
}
