//! Embedded CPU Whisper, adapted from sonolect/sonolect's whisper.rs at 021a50b.
//! No command shell, external service, or test-stub backend is used here.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read, Write},
    path::PathBuf,
    sync::{Mutex, OnceLock},
};
use tauri::{Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL_SHA: &str = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const MODEL_SIZE: u64 = 147951465;
static ENGINE: OnceLock<Mutex<Option<(PathBuf, WhisperContext)>>> = OnceLock::new();
static DOWNLOAD: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub path: String,
    pub ready: bool,
    pub size_bytes: u64,
}

fn default_model(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("models").join("ggml-base.bin");
            if bundled.is_file() {
                return Ok(bundled);
            }
        }
    }
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join("ggml-base.bin"))
}

#[tauri::command]
pub fn local_model_status(
    app: tauri::AppHandle,
    model_path: Option<String>,
) -> Result<ModelStatus, String> {
    let path = match model_path.filter(|p| !p.trim().is_empty()) {
        Some(path) => PathBuf::from(path),
        None => default_model(&app)?,
    };
    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let ready = fs::File::open(&path)
        .and_then(|mut f| {
            let mut magic = [0; 4];
            f.read_exact(&mut magic)?;
            Ok(u32::from_le_bytes(magic) == 0x67676d6c)
        })
        .unwrap_or(false)
        && size > 1_000_000;
    Ok(ModelStatus {
        path: path.to_string_lossy().into(),
        ready,
        size_bytes: size,
    })
}

/// Explicit model installation only. No audio or transcript is transmitted.
#[tauri::command]
pub async fn download_local_model(app: tauri::AppHandle) -> Result<ModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = DOWNLOAD
            .try_lock()
            .map_err(|_| "A model download is already running.")?;
        let path = default_model(&app)?;
        fs::create_dir_all(path.parent().ok_or("Invalid model directory")?)
            .map_err(|e| e.to_string())?;
        let partial = path.with_extension("bin.part");
        let result = (|| -> Result<(), String> {
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(600))
                .build()
                .map_err(|e| e.to_string())?;
            let mut response = client
                .get("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin")
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|e| format!("Model download failed: {e}"))?;
            let mut file = fs::File::create(&partial).map_err(|e| e.to_string())?;
            let mut hash = Sha256::new();
            let mut downloaded = 0u64;
            let mut buffer = [0u8; 65536];
            let mut last_progress = 0;
            loop {
                let count = response.read(&mut buffer).map_err(|e| e.to_string())?;
                if count == 0 {
                    break;
                }
                downloaded += count as u64;
                if downloaded > MODEL_SIZE {
                    return Err("Model exceeded its expected size.".into());
                }
                hash.update(&buffer[..count]);
                file.write_all(&buffer[..count])
                    .map_err(|e| e.to_string())?;
                if downloaded - last_progress > 1_000_000 {
                    let _ = app.emit(
                        "local-model-progress",
                        (downloaded * 100 / MODEL_SIZE) as u32,
                    );
                    last_progress = downloaded;
                }
            }
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            if downloaded != MODEL_SIZE
                || hash
                    .finalize()
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>()
                    != MODEL_SHA
            {
                return Err("Model checksum failed. Please retry the download.".into());
            }
            fs::rename(&partial, &path).map_err(|e| e.to_string())?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&partial);
        }
        result?;
        let _ = app.emit("local-model-progress", 100u32);
        local_model_status(app, None)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn transcribe(
    app: &tauri::AppHandle,
    payload: super::WhisperPayload,
) -> Result<super::WhisperResult, String> {
    transcribe_with_model(default_model(app)?, payload)
}

pub fn transcribe_with_model(
    default_path: PathBuf,
    payload: super::WhisperPayload,
) -> Result<super::WhisperResult, String> {
    if payload.audio_bytes.len() > 5_800_044 {
        return Err("Recording exceeds the three-minute limit.".into());
    }
    let mut reader = hound::WavReader::new(Cursor::new(&payload.audio_bytes))
        .map_err(|e| format!("Invalid WAV audio: {e}"))?;
    let spec = reader.spec();
    if spec.channels != 1
        || spec.sample_rate != 16000
        || spec.bits_per_sample != 16
        || spec.sample_format != hound::SampleFormat::Int
    {
        return Err("Local speech requires mono 16 kHz PCM audio.".into());
    }
    let samples = reader
        .samples::<i16>()
        .map(|s| s.map(|v| v as f32 / 32768.0))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if samples.is_empty() {
        return Err("No audio was recorded.".into());
    }
    let model_path = payload
        .model_path
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_path);
    if !model_path.is_file() {
        return Err("Install the local speech model in Settings first.".into());
    }
    // Exact/near-digital silence should never manufacture a transcript.
    if samples.iter().all(|s| s.abs() < 0.0001) {
        return Ok(super::WhisperResult {
            text: String::new(),
            segments: vec![],
            language: payload.language,
        });
    }
    let mut engine = ENGINE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Speech engine lock failed")?;
    if engine
        .as_ref()
        .map(|(path, _)| path != &model_path)
        .unwrap_or(true)
    {
        let mut config = WhisperContextParameters::default();
        config.use_gpu(false);
        let context = WhisperContext::new_with_params(
            model_path.to_str().ok_or("Invalid model path")?,
            config,
        )
        .map_err(|e| format!("Cannot load speech model: {e}"))?;
        *engine = Some((model_path, context));
    }
    let context = &engine.as_ref().ok_or("Speech engine unavailable")?.1;
    let mut state = context.create_state().map_err(|e| e.to_string())?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let language = payload
        .language
        .as_deref()
        .filter(|l| *l != "auto")
        .map(|l| l.split('-').next().unwrap_or(l));
    params.set_language(language);
    params.set_detect_language(false);
    params.set_translate(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    params.set_no_context(true);
    params.set_suppress_blank(true);
    params.set_n_threads(
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .min(8) as i32,
    );
    state.full(params, &samples).map_err(|e| e.to_string())?;
    let mut segments = vec![];
    for index in 0..state.full_n_segments() {
        let segment = state.get_segment(index).ok_or("Missing speech segment")?;
        let text = segment
            .to_str_lossy()
            .map_err(|e| e.to_string())?
            .trim()
            .to_owned();
        if text.is_empty() {
            continue;
        }
        segments.push(super::WhisperSegment {
            start_ms: segment.start_timestamp().max(0) as u64 * 10,
            end_ms: segment.end_timestamp().max(0) as u64 * 10,
            text,
            speaker: None,
        });
    }
    let text = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let language = whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(str::to_owned);
    Ok(super::WhisperResult {
        text,
        segments,
        language,
    })
}
