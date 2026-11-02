//! Keeping Duet running while an AI is still working, after the designer has closed the window.
//!
//! Closing the window hides it when an AI is mid-task, and Duet quits by itself once the AI is done.
//! With no AI working, closing quits as it always did. The window can be brought back from the Dock
//! (Mac) or the small icon in the menu bar or tray.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// How long after its last tool call an outside AI still counts as working. AI tools think between
/// calls, so a gap of a few seconds must not end the work.
const GRACE: Duration = Duration::from_secs(30);
const TRAY_ID: &str = "duet-still-working";

#[derive(Default)]
pub struct Activity {
    last_call: Mutex<Option<Instant>>,
    watching: AtomicBool,
}

impl Activity {
    /// An outside AI just called a tool, or just got its answer.
    pub fn touch(&self) {
        *self.last_call.lock().unwrap() = Some(Instant::now());
    }
}

/// Whether an AI is working: a request is waiting for an answer, Duet's own chat agent is running,
/// or an outside AI called a tool a moment ago.
pub fn is_working(last_call: Option<Instant>, now: Instant, waiting: bool, chat_agent_running: bool) -> bool {
    waiting || chat_agent_running || last_call.is_some_and(|t| now.saturating_duration_since(t) < GRACE)
}

fn working(app: &AppHandle) -> bool {
    let last = app.try_state::<Arc<Activity>>().and_then(|a| *a.last_call.lock().unwrap());
    is_working(last, Instant::now(), crate::ai::request_waiting(app), crate::ai::chat_agent_running(app))
}

/// The designer closed the window. If an AI is working, hide the window and keep going; the answer
/// tells the interface not to close it.
#[tauri::command]
pub fn keep_running_for_ai(app: AppHandle) -> bool {
    if !working(&app) {
        return false;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    show_sign(&app);
    watch(&app);
    true
}

/// The word an AI's bridge adds when it opens Duet with no window.
pub const BACKGROUND_ARG: &str = "--for-ai";

pub fn started_for_ai() -> bool {
    std::env::args().any(|a| a == BACKGROUND_ARG)
}

/// Opened by an AI: no window, the sign in the menu bar, and quit once the AI is done. The AI's
/// first call is still on its way while Duet starts, so that start counts as working.
pub fn run_hidden(app: &AppHandle) {
    if let Some(activity) = app.try_state::<Arc<Activity>>() {
        activity.touch();
    }
    show_sign(app);
    watch(app);
}

/// The AI needs the designer (a question, a suggestion, or a change to work saved nowhere).
#[tauri::command]
pub fn bring_back(app: AppHandle) {
    // only a window that is gone comes back; one already on screen is never pulled forward,
    // so the designer is not moved to another desktop while an AI works
    if let Some(window) = app.get_webview_window("main") {
        let shown = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
        if shown {
            return;
        }
    }
    show_window(&app);
}

/// Quit once the AI is done. One watcher is enough however many times the window is closed.
fn watch(app: &AppHandle) {
    let Some(activity) = app.try_state::<Arc<Activity>>() else { return };
    if activity.watching.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        // the designer brought the window back: Duet stays open, the next close decides afresh
        let shown = app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false);
        if shown {
            if let Some(activity) = app.try_state::<Arc<Activity>>() {
                activity.watching.store(false, Ordering::SeqCst);
            }
            return;
        }
        if !working(&app) {
            app.exit(0);
            return;
        }
    });
}

/// Bring the window back. The watcher stops being needed once Duet is on screen again, and the
/// AI is left to finish: closing again decides afresh.
pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.remove_tray_by_id(TRAY_ID);
}

/// A visible sign that Duet is still running, since the window is gone.
fn show_sign(app: &AppHandle) {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    if app.tray_by_id(TRAY_ID).is_some() {
        return;
    }
    let build = || -> tauri::Result<()> {
        let show = MenuItem::with_id(app, "show", "Show Duet", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit Duet", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &quit])?;
        let mut tray = TrayIconBuilder::with_id(TRAY_ID)
            .tooltip("Duet is finishing your AI's work")
            .menu(&menu)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "show" => show_window(app),
                _ => app.exit(0),
            });
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.build(app)?;
        Ok(())
    };
    let _ = build();
}

/// Quitting (not just closing the window) while an AI is mid-change asks first.
/// Returns true if the quit should be held back.
pub fn hold_quit(app: &AppHandle) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    if !working(app) {
        return false;
    }
    let again = app.clone();
    app.dialog()
        .message("Your AI is still making changes. Quit anyway? The change in progress may be lost.")
        .title("Quit Duet?")
        .buttons(MessageDialogButtons::OkCancelCustom("Quit anyway".into(), "Keep working".into()))
        .show(move |quit| {
            if quit {
                again.exit(0);
            }
        });
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn working_while_waiting_or_chatting_or_just_called() {
        let now = Instant::now();
        assert!(is_working(None, now, true, false));
        assert!(is_working(None, now, false, true));
        assert!(is_working(Some(now - Duration::from_secs(5)), now, false, false));
    }

    #[test]
    fn not_working_when_quiet_for_a_while() {
        let now = Instant::now();
        assert!(!is_working(None, now, false, false));
        assert!(!is_working(Some(now - Duration::from_secs(31)), now, false, false));
    }
}
