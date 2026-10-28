//! A picture of Duet's own window, drawn by the web view itself. Nothing is read from the screen, so it works
//! while Duet sits behind other windows or on another desktop, and nothing else on the computer can end up in it.

use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
fn take(app: &AppHandle) -> Result<Vec<u8>, String> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;
    use std::sync::mpsc;

    let window = app.get_webview_window("main").ok_or("Duet's window is not open.")?;
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    window
        .with_webview(move |view| {
            let tx = tx.clone();
            // the snapshot is handed back later, on the main thread
            let done = block2::RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let answer = (|| {
                    let image = unsafe { image.as_ref() }.ok_or_else(|| {
                        unsafe { error.as_ref() }.map_or("The window could not be drawn.".to_string(), |e| e.localizedDescription().to_string())
                    })?;
                    let tiff = image.TIFFRepresentation().ok_or("The window picture was empty.")?;
                    let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("The window picture could not be read.")?;
                    let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }.ok_or("The window picture could not be made into a PNG.")?;
                    Ok(png.to_vec())
                })();
                let _ = tx.send(answer);
            });
            let web: &WKWebView = unsafe { &*(view.inner() as *const WKWebView) };
            unsafe { web.takeSnapshotWithConfiguration_completionHandler(None, &done) };
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(10)).map_err(|_| "The window picture took too long.".to_string())?
}

#[cfg(not(target_os = "macos"))]
fn take(_app: &AppHandle) -> Result<Vec<u8>, String> {
    Err("Pictures of the Duet window work on a Mac for now.".into())
}

/// Save a picture of the Duet window as a PNG at `path`. Folders are made as needed.
#[tauri::command(async)]
pub fn window_picture(app: AppHandle, path: String) -> Result<(), String> {
    let png = take(&app)?;
    if let Some(dir) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, png).map_err(|e| format!("Could not save {path}: {e}"))
}
