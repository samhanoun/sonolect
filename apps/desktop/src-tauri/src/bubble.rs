//! Floating dictation bubble: the always-on-top "recorder" window.
//!
//! The window is declared in tauri.conf.json as hidden, undecorated,
//! transparent and non-focusable, so showing it never takes keyboard focus
//! away from the app the user is dictating into. These commands size it and
//! pin it bottom-centre on the monitor under the mouse pointer.

use tauri::plugin::TauriPlugin;
use tauri::{
    AppHandle, LogicalSize, Manager, Monitor, PhysicalPosition, RunEvent, Runtime, WebviewWindow,
    WindowEvent,
};

pub const BUBBLE_LABEL: &str = "recorder";
const MAIN_LABEL: &str = "main";
/// Gap between the bubble and the bottom of the work area (taskbar/dock edge).
const BOTTOM_MARGIN: f64 = 18.0;

fn bubble_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(BUBBLE_LABEL)
        .ok_or_else(|| "The dictation bubble window is missing".to_owned())
}

/// Top-left corner (physical pixels) that puts a `win_w`×`win_h` window
/// bottom-centre inside the given work area.
pub fn bubble_origin(
    area_x: i32,
    area_y: i32,
    area_w: u32,
    area_h: u32,
    win_w: u32,
    win_h: u32,
    margin: u32,
) -> (i32, i32) {
    let x = area_x + (area_w as i32 - win_w as i32) / 2;
    let y = area_y + area_h as i32 - win_h as i32 - margin as i32;
    (x, y.max(area_y))
}

fn target_monitor(app: &AppHandle) -> Option<Monitor> {
    app.cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
}

#[tauri::command]
pub fn bubble_show(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let window = bubble_window(&app)?;
    let width = width.clamp(40.0, 480.0);
    let height = height.clamp(24.0, 240.0);
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    if let Some(monitor) = target_monitor(&app) {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let (x, y) = bubble_origin(
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
            (width * scale).round() as u32,
            (height * scale).round() as u32,
            (BOTTOM_MARGIN * scale).round() as u32,
        );
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    if !window.is_visible().unwrap_or(false) {
        window.show().map_err(|e| e.to_string())?;
    }
    // Some window managers drop the flag while the window is hidden.
    let _ = window.set_always_on_top(true);
    Ok(())
}

#[tauri::command]
pub fn bubble_hide(app: AppHandle) -> Result<(), String> {
    bubble_window(&app)?.hide().map_err(|e| e.to_string())
}

/// Bring the main Sonolect window to the front (double-click on the bubble).
#[tauri::command]
pub fn bubble_open_main(app: AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "The main window is missing".to_owned())?;
    let _ = main.unminimize();
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())
}

/// Called right before pasting a dictation. If clicking the bubble (or the
/// main window) took focus away from the app the user was dictating into,
/// hand focus back to that app so the paste lands there. Does nothing when
/// another app is already in front (the user may have switched on purpose).
#[tauri::command]
pub async fn bubble_restore_target() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        let restored = focus::restore_if_ours();
        if restored {
            // Give the target a moment to process the activation before the paste keystroke.
            std::thread::sleep(std::time::Duration::from_millis(90));
        }
        restored
    })
    .await
    .unwrap_or(false)
}

/// The bubble's lifecycle hooks, registered with `.plugin(bubble::init())`.
///
/// They live in a plugin rather than in `Builder::setup` because a second
/// `.setup(...)` on the app builder silently replaces the first one, so two
/// features that each add their own would break one of them without a
/// compile error.
///
/// - On startup, start tracking which other app was last in front (Windows),
///   so a dictation can be pasted back into it.
/// - Closing the main window quits the app instead of leaving the hidden
///   bubble window (and the microphone engine with it) running invisibly.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("sonolect-bubble")
        // Plugins are set up on the main thread, whose event loop pumps the
        // out-of-context WinEvent messages the focus hook relies on.
        .setup(|_app, _api| {
            focus::install();
            Ok(())
        })
        .on_event(|app, event| {
            if let RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { .. },
                ..
            } = event
            {
                if label == MAIN_LABEL {
                    app.exit(0);
                }
            }
        })
        .build()
}

#[cfg(target_os = "windows")]
mod focus {
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use std::sync::atomic::{AtomicPtr, Ordering};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
        EVENT_SYSTEM_FOREGROUND, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    };

    /// The last foreground window that belongs to another app: the paste target.
    static LAST_EXTERNAL: AtomicPtr<c_void> = AtomicPtr::new(null_mut());

    fn is_own(hwnd: HWND) -> bool {
        let mut pid = 0u32;
        // SAFETY: GetWindowThreadProcessId accepts any window handle and only
        // writes the owning process id into `pid`.
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        // SAFETY: GetCurrentProcessId has no preconditions.
        pid == unsafe { GetCurrentProcessId() }
    }

    unsafe extern "system" fn on_foreground(
        _hook: HWINEVENTHOOK,
        _event: u32,
        hwnd: HWND,
        _object: i32,
        _child: i32,
        _thread: u32,
        _time: u32,
    ) {
        // WINEVENT_SKIPOWNPROCESS: our own windows never reach this callback.
        if !hwnd.is_null() {
            LAST_EXTERNAL.store(hwnd, Ordering::Relaxed);
        }
    }

    pub fn install() {
        // SAFETY: plain Win32 calls. The hook procedure is a static function and
        // the hook lives for the whole process; plugin setup runs on the main
        // thread, whose event loop pumps the out-of-context hook messages.
        unsafe {
            let current = GetForegroundWindow();
            if !current.is_null() && !is_own(current) {
                LAST_EXTERNAL.store(current, Ordering::Relaxed);
            }
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                null_mut(),
                Some(on_foreground),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );
        }
    }

    pub fn restore_if_ours() -> bool {
        let target = LAST_EXTERNAL.load(Ordering::Relaxed);
        if target.is_null() {
            return false;
        }
        // SAFETY: the handles are only compared and passed back to user32,
        // which validates them (IsWindow) before use.
        unsafe {
            let current = GetForegroundWindow();
            if !current.is_null() && !is_own(current) {
                return false;
            }
            if IsWindow(target) == 0 {
                return false;
            }
            SetForegroundWindow(target) != 0
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod focus {
    pub fn install() {}

    pub fn restore_if_ours() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::bubble_origin;

    #[test]
    fn centres_the_bubble_above_the_bottom_edge() {
        // 1920×1040 work area (taskbar at the bottom), 300×92 bubble, 18px gap.
        assert_eq!(bubble_origin(0, 0, 1920, 1040, 300, 92, 18), (810, 930));
    }

    #[test]
    fn respects_monitor_offsets() {
        // Second monitor to the left of the primary one.
        assert_eq!(
            bubble_origin(-2560, 0, 2560, 1400, 600, 184, 36),
            (-1580, 1180)
        );
    }

    #[test]
    fn never_goes_above_the_work_area() {
        assert_eq!(bubble_origin(0, 100, 400, 50, 300, 92, 18), (50, 100));
    }
}
