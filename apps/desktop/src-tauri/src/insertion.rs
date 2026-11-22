//! Paste dictated text into whichever app has focus.
//!
//! On Windows this is done in-process: the text goes on the clipboard (kept out
//! of clipboard history and the cloud clipboard), Ctrl+V is injected with
//! `SendInput`, and the user's previous clipboard text is put back once the
//! target app has had time to read it. Starting PowerShell for every paste, as
//! the old implementation did, added roughly half a second to a second of
//! latency per dictation and left every dictation in clipboard history.
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertionResult {
    pub ok: bool,
    /// `native-insert`: pasted. `clipboard-only`: the text is on the clipboard
    /// but the paste keystroke failed, so the user can press Ctrl+V.
    /// `clipboard-fallback`: nothing was done; the web layer should copy it.
    pub method: String,
    pub status: String,
}

/// What a platform implementation managed to do.
#[derive(Debug, PartialEq)]
enum Outcome {
    Pasted,
    // Only the Windows paste path can tell a clipboard write from a keystroke.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    ClipboardOnly(String),
    Failed(String),
}

fn result_for(outcome: Outcome) -> InsertionResult {
    match outcome {
        Outcome::Pasted => InsertionResult {
            ok: true,
            method: "native-insert".to_owned(),
            status: "Inserted polished dictation into the active app.".to_owned(),
        },
        Outcome::ClipboardOnly(error) => InsertionResult {
            ok: false,
            method: "clipboard-only".to_owned(),
            status: format!("Copied to the clipboard, but pasting failed ({error}). Press Ctrl+V."),
        },
        Outcome::Failed(error) => InsertionResult {
            ok: false,
            method: "clipboard-fallback".to_owned(),
            status: format!("Native insertion unavailable: {error}"),
        },
    }
}

/// Runs off the main thread so a slow target app can never freeze the UI.
#[tauri::command]
pub async fn insert_text_into_active_app(text: String) -> InsertionResult {
    tauri::async_runtime::spawn_blocking(move || insert_blocking(&text))
        .await
        .unwrap_or_else(|_| result_for(Outcome::Failed("insertion was interrupted".to_owned())))
}

/// The clipboard text a paste on Windows is to give back, until it is given
/// back or a later paste takes the restore over.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Debug)]
struct Restore {
    /// Counts the pastes, so a restore knows when a later one took over.
    turn: u64,
    /// What the paste put on the clipboard.
    dictated: String,
    /// What the clipboard held before, when that was text.
    original: Option<String>,
}

/// The clipboard text to give back after a paste: what the clipboard holds
/// now (`current`), unless it is still the text of the paste just before,
/// whose restore has not run yet. Then the user copied nothing since, and
/// what they had before that paste is the one to give back.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn original_text(pending: Option<&Restore>, current: Option<String>) -> Option<String> {
    match pending {
        Some(last) if current.as_deref() == Some(last.dictated.as_str()) => last.original.clone(),
        _ => current,
    }
}

fn insert_blocking(text: &str) -> InsertionResult {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return InsertionResult {
            ok: false,
            method: "clipboard-fallback".to_owned(),
            status: "Nothing to insert yet.".to_owned(),
        };
    }
    result_for(platform::insert(trimmed))
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{Outcome, Restore};
    use arboard::{Clipboard, SetExtWindows};
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    use std::sync::{Mutex, MutexGuard, PoisonError};
    use std::time::Duration;

    /// Slow Electron and Office apps read the clipboard a little after the
    /// keystroke arrives; restoring sooner could paste the old clipboard.
    const RESTORE_AFTER: Duration = Duration::from_millis(750);

    struct Pastes {
        turn: u64,
        pending: Option<Restore>,
    }

    /// One paste at a time, and the restore the last one still owes.
    static PASTES: Mutex<Pastes> = Mutex::new(Pastes {
        turn: 0,
        pending: None,
    });

    fn lock_pastes() -> MutexGuard<'static, Pastes> {
        PASTES.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn send_paste() -> Result<(), String> {
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo
            .key(Key::Control, Direction::Press)
            .map_err(|e| e.to_string())?;
        // Key::V is the layout-independent virtual key, so this also works on
        // AZERTY, Cyrillic and other layouts.
        let pasted = enigo.key(Key::V, Direction::Click);
        let released = enigo.key(Key::Control, Direction::Release);
        pasted.map_err(|e| e.to_string())?;
        released.map_err(|e| e.to_string())
    }

    pub(super) fn insert(text: &str) -> Outcome {
        let mut pastes = lock_pastes();
        let mut clipboard = match Clipboard::new() {
            Ok(clipboard) => clipboard,
            Err(error) => return Outcome::Failed(format!("clipboard unavailable: {error}")),
        };
        // Two dictations in quick succession give back what the user had
        // before the first, not the first dictation.
        let original = super::original_text(pastes.pending.as_ref(), clipboard.get_text().ok());
        if let Err(error) = clipboard
            .set()
            .exclude_from_history()
            .exclude_from_cloud()
            .text(text.to_owned())
        {
            return Outcome::Failed(format!("could not write the clipboard: {error}"));
        }
        drop(clipboard);
        // The clipboard holds this paste now: a restore the last paste still
        // owes is this one's to do.
        pastes.turn += 1;
        let turn = pastes.turn;
        pastes.pending = None;
        if let Err(error) = send_paste() {
            // Leave the dictation on the clipboard so the user can paste it.
            return Outcome::ClipboardOnly(error);
        }
        let restore = original.is_some();
        pastes.pending = Some(Restore {
            turn,
            dictated: text.to_owned(),
            original,
        });
        drop(pastes);
        if restore {
            std::thread::spawn(move || {
                std::thread::sleep(RESTORE_AFTER);
                let mut pastes = lock_pastes();
                // A later paste took the restore over.
                if pastes.pending.as_ref().map(|pending| pending.turn) != Some(turn) {
                    return;
                }
                let Some(Restore {
                    dictated,
                    original: Some(original),
                    ..
                }) = pastes.pending.take()
                else {
                    return;
                };
                if let Ok(mut clipboard) = Clipboard::new() {
                    // Only restore if nobody copied something else meanwhile.
                    if clipboard.get_text().ok().as_deref() == Some(dictated.as_str()) {
                        let _ = clipboard.set_text(original);
                    }
                }
            });
        }
        Outcome::Pasted
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::Outcome;
    use std::process::Command;

    pub(super) fn insert(text: &str) -> Outcome {
        let output = Command::new("osascript")
            .arg("-e")
            .arg("set the clipboard to (system attribute \"SONOLECT_INSERT_TEXT\")")
            .arg("-e")
            .arg("tell application \"System Events\" to keystroke \"v\" using command down")
            .env("SONOLECT_INSERT_TEXT", text)
            .output();
        match output {
            Ok(output) if output.status.success() => Outcome::Pasted,
            Ok(output) => {
                Outcome::Failed(String::from_utf8_lossy(&output.stderr).trim().to_owned())
            }
            Err(error) => Outcome::Failed(format!(
                "failed to run the macOS insertion command: {error}"
            )),
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::Outcome;
    use std::process::Command;

    fn command_exists(program: &str) -> bool {
        Command::new(program)
            .arg("--version")
            .output()
            .map(|output| {
                output.status.success() || !output.stderr.is_empty() || !output.stdout.is_empty()
            })
            .unwrap_or(false)
    }

    // wl-copy, xclip and xsel stay in the background to serve the clipboard
    // until something else is copied, and keep the output they were given.
    // Theirs goes nowhere, so the paste does not wait for them to end.
    pub(super) const WAYLAND: &str =
        "printf %s \"$SONOLECT_INSERT_TEXT\" | wl-copy >/dev/null 2>&1 && wtype -M ctrl v -m ctrl";
    pub(super) const XCLIP: &str = "printf %s \"$SONOLECT_INSERT_TEXT\" | xclip -selection clipboard >/dev/null 2>&1 && xdotool key ctrl+v";
    pub(super) const XSEL: &str = "printf %s \"$SONOLECT_INSERT_TEXT\" | xsel --clipboard --input >/dev/null 2>&1 && xdotool key ctrl+v";

    /// Whether the session has this kind of display.
    fn session(variable: &str) -> bool {
        std::env::var_os(variable).is_some_and(|value| !value.is_empty())
    }

    pub(super) fn insert(text: &str) -> Outcome {
        let wayland = session("WAYLAND_DISPLAY");
        let x11 = session("DISPLAY");
        let script = if wayland && command_exists("wl-copy") && command_exists("wtype") {
            WAYLAND
        } else if x11 && command_exists("xclip") && command_exists("xdotool") {
            XCLIP
        } else if x11 && command_exists("xsel") && command_exists("xdotool") {
            XSEL
        } else {
            return Outcome::Failed(
                "Install wl-copy+wtype or xclip/xsel+xdotool for direct Linux insertion".to_owned(),
            );
        };
        run(paste(script, text))
    }

    /// The text travels in an environment variable, never in the script.
    pub(super) fn paste(script: &str, text: &str) -> Command {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg(script)
            .env("SONOLECT_INSERT_TEXT", text);
        command
    }

    pub(super) fn run(mut command: Command) -> Outcome {
        match command.output() {
            Ok(output) if output.status.success() => Outcome::Pasted,
            Ok(output) => {
                let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
                Outcome::Failed(if error.is_empty() {
                    "the clipboard could not be written".to_owned()
                } else {
                    error
                })
            }
            Err(error) => Outcome::Failed(format!(
                "failed to run the Linux insertion command: {error}"
            )),
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod platform {
    use super::Outcome;

    pub(super) fn insert(_text: &str) -> Outcome {
        Outcome::Failed("direct insertion is unsupported on this operating system".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_empty_native_insertion_as_clipboard_fallback() {
        let result = insert_blocking("   ");

        assert!(!result.ok);
        assert_eq!(result.method, "clipboard-fallback");
        assert_eq!(result.status, "Nothing to insert yet.");
    }

    #[test]
    fn a_failed_keystroke_keeps_the_text_on_the_clipboard() {
        let result = result_for(Outcome::ClipboardOnly("blocked".to_owned()));
        assert!(!result.ok);
        assert_eq!(result.method, "clipboard-only");
        assert!(result.status.contains("Ctrl+V"));

        let pasted = result_for(Outcome::Pasted);
        assert!(pasted.ok);
        assert_eq!(pasted.method, "native-insert");

        let failed = result_for(Outcome::Failed("no clipboard".to_owned()));
        assert!(!failed.ok);
        assert_eq!(failed.method, "clipboard-fallback");
    }

    #[test]
    fn quick_dictations_give_back_what_the_user_had_before_the_first() {
        let restore = |dictated: &str, original: Option<&str>| Restore {
            turn: 1,
            dictated: dictated.into(),
            original: original.map(str::to_owned),
        };
        let first = restore("first dictation", Some("copied by the user"));
        // The first restore has not run: the clipboard still holds it.
        assert_eq!(
            original_text(Some(&first), Some("first dictation".into())).as_deref(),
            Some("copied by the user")
        );
        // It held no text (an image, say): there is none to give back.
        assert_eq!(
            original_text(
                Some(&restore("first dictation", None)),
                Some("first dictation".into())
            ),
            None
        );
        // The user copied something since, or nothing is owed.
        assert_eq!(
            original_text(Some(&first), Some("copied since".into())).as_deref(),
            Some("copied since")
        );
        assert_eq!(original_text(Some(&first), None), None);
        assert_eq!(
            original_text(None, Some("copied".into())).as_deref(),
            Some("copied")
        );
    }

    /// A folder of stand-ins for the Linux clipboard and keyboard tools. The
    /// clipboard one stays in the background with its output, as xclip does.
    #[cfg(target_os = "linux")]
    fn stand_ins(clipboard: &str) -> tempfile::TempDir {
        use std::os::unix::fs::PermissionsExt;
        let folder = tempfile::tempdir().unwrap();
        for (name, script) in [
            ("xclip", clipboard),
            ("xdotool", "echo \"$@\" > \"$STAND_INS/keys\""),
        ] {
            let path = folder.path().join(name);
            std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        folder
    }

    #[cfg(target_os = "linux")]
    fn paste_with(folder: &std::path::Path, text: &str) -> Outcome {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![folder.to_path_buf()];
        paths.extend(std::env::split_paths(&path));
        let mut command = platform::paste(platform::XCLIP, text);
        command
            .env("PATH", std::env::join_paths(paths).unwrap())
            .env("STAND_INS", folder);
        platform::run(command)
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_linux_paste_does_not_wait_for_the_clipboard_to_be_taken() {
        let folder = stand_ins("cat > \"$STAND_INS/clipboard\"\nsleep 15 &");
        let started = std::time::Instant::now();
        assert_eq!(paste_with(folder.path(), "hello there"), Outcome::Pasted);
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
        let read = |name: &str| std::fs::read_to_string(folder.path().join(name)).unwrap();
        assert_eq!(read("clipboard"), "hello there");
        assert_eq!(read("keys"), "key ctrl+v\n");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_linux_clipboard_that_cannot_be_written_is_reported() {
        let folder = stand_ins("echo \"Error: Can't open display\" >&2\nexit 1");
        assert_eq!(
            paste_with(folder.path(), "hello"),
            Outcome::Failed("the clipboard could not be written".to_owned())
        );
        assert!(!folder.path().join("keys").exists());
    }
}
