//! System ("what you hear") audio capture through the platform recorder.
//!
//! The recording path is chosen here, inside the app's capture folder, and only
//! the recorder this app started is stopped. Previously the web layer passed any
//! output path (an arbitrary file write) and stopping ran `pkill`, which also
//! killed unrelated `parec`/`ffmpeg` processes on the machine.
use std::{
    process::{Child, Command},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

static RECORDER: Mutex<Option<Child>> = Mutex::new(None);

#[tauri::command]
pub fn check_system_audio_available() -> bool {
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
        Command::new("system_profiler")
            .arg("SPAudioDataType")
            .output()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .to_lowercase()
                    .contains("blackhole")
            })
            .unwrap_or(false)
    }
    // Windows needs a native WASAPI loopback recorder, which is not built yet.
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        false
    }
}

#[cfg(target_os = "linux")]
fn spawn_recorder(output: &std::path::Path) -> Result<Child, String> {
    let sources = Command::new("pactl")
        .args(["list", "short", "sources"])
        .output()
        .map_err(|e| format!("pactl failed: {e}"))?;
    let sources = String::from_utf8_lossy(&sources.stdout);
    let monitor = sources
        .lines()
        .find(|line| line.contains("monitor"))
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or("No PulseAudio monitor source found")?;
    Command::new("parec")
        .arg("--device")
        .arg(monitor)
        .arg("--file-format=wav")
        .arg(output)
        .spawn()
        .map_err(|e| format!("Failed to start parec: {e}"))
}

#[cfg(target_os = "macos")]
fn spawn_recorder(output: &std::path::Path) -> Result<Child, String> {
    Command::new("ffmpeg")
        .args(["-nostdin", "-f", "avfoundation", "-i", ":BlackHole 2ch"])
        .args(["-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1"])
        .arg(output)
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg capture: {e}"))
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn spawn_recorder(_output: &std::path::Path) -> Result<Child, String> {
    Err("System audio capture is not available on this platform yet.".to_owned())
}

/// Starts recording system audio and returns the file it is written to.
#[tauri::command]
pub fn start_system_audio_capture(app: tauri::AppHandle) -> Result<String, String> {
    let mut recorder = RECORDER.lock().map_err(|_| "Recorder lock failed")?;
    if let Some(child) = recorder.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            return Err("System audio is already being recorded.".to_owned());
        }
    }
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("captures");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let output = directory.join(format!("system-{stamp}.wav"));
    *recorder = Some(spawn_recorder(&output)?);
    Ok(output.to_string_lossy().into_owned())
}

/// Stops only the recorder started above, letting it finish the WAV header.
#[tauri::command]
pub fn stop_system_audio_capture() -> Result<(), String> {
    let Some(mut child) = RECORDER.lock().map_err(|_| "Recorder lock failed")?.take() else {
        return Ok(());
    };
    #[cfg(unix)]
    {
        use std::time::{Duration, Instant};
        // SIGTERM lets parec/ffmpeg write the final WAV header; SIGKILL would not.
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(child.id().to_string())
            .status();
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    Ok(())
}
