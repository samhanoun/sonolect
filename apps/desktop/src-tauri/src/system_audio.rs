//! System ("what you hear") audio as the source of a recording.
//!
//! The window starts a recording with `capture_begin` and then asks this
//! module to feed it instead of the microphone: on Windows from the default
//! playback device through WASAPI loopback, on Linux from the PulseAudio
//! monitor of the default output (`parec`), on macOS from a BlackHole device
//! (`ffmpeg`). The audio goes straight into the recording and never passes
//! through the webview. The window chooses no path and no device, and only
//! the recorder this app started is ever stopped.
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::Emitter;

use super::{
    audio_feed::{self, Source},
    streaming,
};

/// Ends a source from outside its thread (a recorder process is told to quit).
type Closer = Box<dyn FnOnce() + Send>;

struct Session {
    closing: Arc<AtomicBool>,
    close: Option<Closer>,
    thread: JoinHandle<()>,
}

/// The one system-audio feed in progress.
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

/// How long a source may take to open before the recording is refused.
const OPEN_TIMEOUT: Duration = Duration::from_secs(10);
/// The level meter in the window is told the loudness this often at most.
const LEVEL_EVERY: Duration = Duration::from_millis(100);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EndedEvent {
    id: String,
    message: String,
}

#[tauri::command(async)]
pub fn check_system_audio_available() -> bool {
    available()
}

#[cfg(target_os = "windows")]
fn available() -> bool {
    super::system_loopback::available()
}

#[cfg(target_os = "linux")]
fn available() -> bool {
    use std::process::Command;
    let runs = |program: &str| {
        Command::new(program)
            .arg("--version")
            .output()
            .is_ok_and(|output| output.status.success())
    };
    runs("pactl") && runs("parec")
}

/// Where `ffmpeg` is. An app opened from the Finder does not get the shell's
/// `PATH`, so the usual Homebrew folders are tried as well.
#[cfg(target_os = "macos")]
fn ffmpeg() -> Option<&'static str> {
    [
        "ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
    ]
    .into_iter()
    .find(|program| {
        std::process::Command::new(program)
            .arg("-version")
            .output()
            .is_ok_and(|output| output.status.success())
    })
}

#[cfg(target_os = "macos")]
fn available() -> bool {
    ffmpeg().is_some()
        && std::process::Command::new("system_profiler")
            .arg("SPAudioDataType")
            .output()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .to_lowercase()
                    .contains("blackhole")
            })
            .unwrap_or(false)
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn available() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn open(closing: &Arc<AtomicBool>) -> Result<(Box<dyn Source>, Option<Closer>), String> {
    let source = super::system_loopback::open(Arc::clone(closing))?;
    Ok((Box::new(source), None))
}

/// The monitor of the default output: what is playing through it.
#[cfg(target_os = "linux")]
fn monitor_source() -> Result<String, String> {
    use std::process::Command;
    let pactl = |arguments: &[&str]| {
        Command::new("pactl")
            .args(arguments)
            .output()
            .map_err(|error| format!("pactl failed: {error}"))
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
    };
    let sources = pactl(&["list", "short", "sources"])?;
    let names: Vec<&str> = sources
        .lines()
        .filter_map(|line| line.split_whitespace().nth(1))
        .collect();
    let preferred = pactl(&["get-default-sink"])
        .ok()
        .map(|sink| format!("{}.monitor", sink.trim()));
    preferred
        .filter(|monitor| names.contains(&monitor.as_str()))
        .or_else(|| {
            names
                .iter()
                .find(|name| name.ends_with(".monitor"))
                .map(|name| (*name).to_owned())
        })
        .ok_or_else(|| "No PulseAudio monitor source found.".to_owned())
}

#[cfg(target_os = "linux")]
fn recorder() -> Result<std::process::Command, String> {
    let mut command = std::process::Command::new("parec");
    command
        .arg(format!("--device={}", monitor_source()?))
        .args(["--raw", "--format=s16le", "--rate=16000", "--channels=1"]);
    Ok(command)
}

#[cfg(target_os = "macos")]
fn recorder() -> Result<std::process::Command, String> {
    let mut command =
        std::process::Command::new(ffmpeg().ok_or("ffmpeg is needed to record system audio.")?);
    command
        .args(["-nostdin", "-loglevel", "error"])
        .args(["-f", "avfoundation", "-i", ":BlackHole 2ch"])
        .args([
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-",
        ]);
    Ok(command)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn open(_closing: &Arc<AtomicBool>) -> Result<(Box<dyn Source>, Option<Closer>), String> {
    use std::process::Stdio;
    let mut child = recorder()?
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Cannot start the system audio recorder: {error}"))?;
    let Some(output) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Cannot read the system audio recorder.".into());
    };
    Ok((
        Box::new(audio_feed::Piped::new(output)),
        Some(Box::new(move || quit(child))),
    ))
}

/// Asks the recorder this app started to quit, and makes sure it is gone.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn quit(mut child: std::process::Child) {
    // Already gone and collected: its process ID may belong to another
    // process by now, so nothing is signalled.
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    // SIGTERM lets the recorder flush what it has; the pipe then closes.
    let _ = std::process::Command::new("kill")
        .arg("-TERM")
        .arg(child.id().to_string())
        .status();
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn open(_closing: &Arc<AtomicBool>) -> Result<(Box<dyn Source>, Option<Closer>), String> {
    Err("System audio capture is not available on this platform.".into())
}

/// What the window is told when a feed ends: nothing when it was asked to
/// stop or its recording has already ended, otherwise what went wrong.
fn ended_message(ended: Option<String>, asked: bool) -> Option<String> {
    match ended {
        Some(message) if message == streaming::NOT_IN_PROGRESS => None,
        Some(message) => Some(message),
        None if asked => None,
        None => Some("System audio stopped unexpectedly.".into()),
    }
}

/// Feeds the recording `id` with what is playing on this computer, until
/// `stop_system_audio_capture` or the end of the recording.
#[tauri::command(async)]
pub fn start_system_audio_capture(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if streaming::live_id().as_deref() != Some(id.as_str()) {
        return Err(streaming::NOT_IN_PROGRESS.into());
    }
    // A feed left over from a recording that was never stopped.
    stop();
    let closing = Arc::new(AtomicBool::new(false));
    let (opened, ready) = mpsc::channel::<Result<Option<Closer>, String>>();
    let thread = std::thread::Builder::new()
        .name("system-audio".into())
        .spawn({
            let closing = Arc::clone(&closing);
            move || {
                // Opened on this thread: a WASAPI stream stays on the thread
                // that made it.
                let mut source = match open(&closing) {
                    Ok((source, close)) => {
                        if let Err(mpsc::SendError(unsent)) = opened.send(Ok(close)) {
                            // Nobody is waiting any more: end what was opened.
                            if let Ok(Some(close)) = unsent {
                                close();
                            }
                            return;
                        }
                        source
                    }
                    Err(message) => {
                        let _ = opened.send(Err(message));
                        return;
                    }
                };
                let started = Instant::now();
                let mut level_sent = Instant::now();
                let ended = audio_feed::pump(
                    source.as_mut(),
                    || started.elapsed(),
                    |samples| {
                        streaming::append_live(&id, samples)?;
                        if level_sent.elapsed() >= LEVEL_EVERY {
                            level_sent = Instant::now();
                            let _ = app.emit("system-audio-level", audio_feed::peak(samples));
                        }
                        Ok(())
                    },
                );
                drop(source);
                let asked = closing.load(Ordering::Relaxed);
                if let Some(message) = ended_message(ended, asked) {
                    let _ = app.emit("system-audio-ended", EndedEvent { id, message });
                }
            }
        })
        .map_err(|error| format!("Cannot start recording system audio: {error}"))?;
    let close = match ready.recv_timeout(OPEN_TIMEOUT) {
        Ok(Ok(close)) => close,
        Ok(Err(message)) => {
            let _ = thread.join();
            return Err(message);
        }
        Err(_) => {
            // Still opening: it ends by itself as soon as it has opened.
            closing.store(true, Ordering::Relaxed);
            return Err("System audio did not start.".into());
        }
    };
    *SESSION.lock().map_err(|_| "System audio is unavailable.")? = Some(Session {
        closing,
        close,
        thread,
    });
    Ok(())
}

/// Stops the feed and waits until all of its audio is in the recording.
#[tauri::command(async)]
pub fn stop_system_audio_capture() {
    stop();
}

fn stop() {
    let session = SESSION.lock().ok().and_then(|mut session| session.take());
    let Some(session) = session else {
        return;
    };
    session.closing.store(true, Ordering::Relaxed);
    if let Some(close) = session.close {
        close();
    }
    let _ = session.thread.join();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_nothing_when_a_feed_was_stopped_or_its_recording_ended() {
        assert_eq!(ended_message(None, true), None);
        assert_eq!(
            ended_message(Some(streaming::NOT_IN_PROGRESS.into()), false),
            None
        );
    }

    #[test]
    fn reports_a_feed_that_ended_by_itself() {
        assert_eq!(
            ended_message(None, false).as_deref(),
            Some("System audio stopped unexpectedly.")
        );
        assert_eq!(
            ended_message(
                Some("The recording reached the four-hour limit.".into()),
                true
            )
            .as_deref(),
            Some("The recording reached the four-hour limit.")
        );
    }

    /// The recorder is a real process here: a shell that writes samples and
    /// then waits, as `parec` does, until it is told to quit.
    #[cfg(target_os = "linux")]
    #[test]
    fn reads_a_recorder_process_and_stops_it() {
        use std::process::{Command, Stdio};
        let mut child = Command::new("sh")
            .args([
                "-c",
                "printf '\\001\\000\\002\\000\\003\\000'; exec sleep 30",
            ])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let pid = child.id();
        let mut source = audio_feed::Piped::new(child.stdout.take().unwrap());
        let mut read = Vec::new();
        while read.len() < 3 {
            match source.next() {
                audio_feed::Feed::Audio(audio) => read.extend(audio),
                audio_feed::Feed::Quiet => {}
                audio_feed::Feed::Ended(reason) => panic!("ended early: {reason:?}"),
            }
        }
        assert_eq!(read, [1, 2, 3]);
        let started = Instant::now();
        quit(child);
        assert!(started.elapsed() < Duration::from_secs(2));
        // The pipe is closed, so the source ends without an error.
        assert!(matches!(source.next(), audio_feed::Feed::Ended(None)));
        assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
    }
}
