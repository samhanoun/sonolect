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
    use super::Outcome;
    use arboard::{Clipboard, SetExtWindows};
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    use std::time::Duration;

    /// Slow Electron and Office apps read the clipboard a little after the
    /// keystroke arrives; restoring sooner could paste the old clipboard.
    const RESTORE_AFTER: Duration = Duration::from_millis(750);

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
        let mut clipboard = match Clipboard::new() {
            Ok(clipboard) => clipboard,
            Err(error) => return Outcome::Failed(format!("clipboard unavailable: {error}")),
        };
        let previous = clipboard.get_text().ok();
        if let Err(error) = clipboard
            .set()
            .exclude_from_history()
            .exclude_from_cloud()
            .text(text.to_owned())
        {
            return Outcome::Failed(format!("could not write the clipboard: {error}"));
        }
        drop(clipboard);
        if let Err(error) = send_paste() {
            // Leave the dictation on the clipboard so the user can paste it.
            return Outcome::ClipboardOnly(error);
        }
        if let Some(previous) = previous {
            let dictated = text.to_owned();
            std::thread::spawn(move || {
                std::thread::sleep(RESTORE_AFTER);
                if let Ok(mut clipboard) = Clipboard::new() {
                    // Only restore if nobody copied something else meanwhile.
                    if clipboard.get_text().ok().as_deref() == Some(dictated.as_str()) {
                        let _ = clipboard.set_text(previous);
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

    pub(super) fn insert(text: &str) -> Outcome {
        let script = if command_exists("wl-copy") && command_exists("wtype") {
            "printf %s \"$SONOLECT_INSERT_TEXT\" | wl-copy && wtype -M ctrl v -m ctrl"
        } else if command_exists("xclip") && command_exists("xdotool") {
            "printf %s \"$SONOLECT_INSERT_TEXT\" | xclip -selection clipboard && xdotool key ctrl+v"
        } else if command_exists("xsel") && command_exists("xdotool") {
            "printf %s \"$SONOLECT_INSERT_TEXT\" | xsel --clipboard --input && xdotool key ctrl+v"
        } else {
            return Outcome::Failed(
                "Install wl-copy+wtype or xclip/xsel+xdotool for direct Linux insertion".to_owned(),
            );
        };
        // The text travels in an environment variable, never in the script.
        match Command::new("sh")
            .arg("-c")
            .arg(script)
            .env("SONOLECT_INSERT_TEXT", text)
            .output()
        {
            Ok(output) if output.status.success() => Outcome::Pasted,
            Ok(output) => {
                Outcome::Failed(String::from_utf8_lossy(&output.stderr).trim().to_owned())
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
}
