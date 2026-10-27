mod ai;
mod files;
mod grade;
mod keepalive;
mod package;
mod psd;
mod trash;
mod video;

use git2::{Repository, Signature};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------- files ----------

/// Read a UTF-8 text file. Used to open a project's design.json.
#[tauri::command(async)]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Could not read {path}: {e}"))
}

/// Write a text file safely: write to a temp file next to it, then rename.
/// A crash mid-save can never leave a half-written design behind.
#[tauri::command(async)]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create folder: {e}"))?;
    }
    let tmp = format!("{path}.tmp");
    fs::write(&tmp, contents).map_err(|e| format!("Could not write {path}: {e}"))?;
    fs::rename(&tmp, target).map_err(|e| format!("Could not save {path}: {e}"))
}

/// Save a binary file (such as a PNG). The picture arrives as base64 text.
#[tauri::command(async)]
fn write_binary_file(path: String, data_base64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("The picture data was not valid: {e}"))?;
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create folder: {e}"))?;
    }
    let tmp = format!("{path}.tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("Could not write {path}: {e}"))?;
    fs::rename(&tmp, target).map_err(|e| format!("Could not save {path}: {e}"))
}

/// Read a binary file (such as a picture) and hand it over as base64 text.
#[tauri::command(async)]
fn read_binary_file(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Move or rename a project file. Never replaces a file that is already there.
#[tauri::command]
fn move_project(from: String, to: String) -> Result<(), String> {
    let (a, b) = (Path::new(&from), Path::new(&to));
    if b.exists() {
        return Err("There is already a file with that name there. Pick another name.".into());
    }
    if fs::rename(a, b).is_err() {
        // another disk cannot be renamed onto, so the file is copied and the old one let go
        fs::copy(a, b).map_err(|e| format!("Could not move the project: {e}"))?;
        fs::remove_file(a).map_err(|e| format!("The project was copied, but the old file could not be removed: {e}"))?;
    }
    Ok(())
}

/// Copy a project file. Never replaces a file that is already there.
#[tauri::command]
fn copy_project(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err("There is already a file with that name there. Pick another name.".into());
    }
    fs::copy(&from, &to).map(|_| ()).map_err(|e| format!("Could not copy the project: {e}"))
}

#[tauri::command]
fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Could not create {path}: {e}"))
}

// ---------- Duet's own folder: ~/.duet ----------
// Skills the designer writes live here, so they travel across projects.

/// True in Duet dev: a second Duet started only to build and check Duet itself (`scripts/dev-duet.sh`).
/// It keeps everything of its own in another folder, so it never meets the Duet a designer is working in.
pub fn is_check_copy() -> bool {
    std::env::var("DUET_DEV").map(|v| !v.is_empty() && v != "0").unwrap_or(false)
}

/// The name of Duet's own folder in the home folder.
pub fn duet_dir_name() -> &'static str {
    if is_check_copy() {
        ".duet-dev"
    } else {
        ".duet"
    }
}

/// A program Duet starts in the background. On Windows every console program gets a black window
/// of its own unless told not to, so the agent, its checks and ffmpeg would flash one each time.
pub fn quiet_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

#[tauri::command(async)]
fn check_copy() -> bool {
    is_check_copy()
}

fn duet_home_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not find your home folder.".to_string())?;
    let dir = Path::new(&home).join(duet_dir_name());
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

#[tauri::command]
fn duet_home() -> Result<String, String> {
    Ok(duet_home_dir()?.to_string_lossy().to_string())
}

/// Where a project file keeps its unpacked working copy.
#[tauri::command]
fn work_dir_for(file: String) -> Result<String, String> {
    Ok(package::work_dir_for_file(&file)?.to_string_lossy().to_string())
}

/// An empty working folder for a new project file.
#[tauri::command(async)]
fn fresh_work_dir(file: String) -> Result<String, String> {
    let dir = package::work_dir_for_file(&file)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(err)?;
    }
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.to_string_lossy().to_string())
}

/// File work runs off the screen's thread so Duet never freezes on a big project. Packing,
/// unpacking and history steps take turns, so a pack never reads a step half written.
static FILE_WORK: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn file_turn() -> std::sync::MutexGuard<'static, ()> {
    FILE_WORK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Pack a project's working folder into its single file.
#[tauri::command(async)]
fn pack_project(dir: String, file: String) -> Result<(), String> {
    let _turn = file_turn();
    package::pack(Path::new(&dir), Path::new(&file))
}

/// Make a second project file to hand to someone else. The working folder is only read.
#[tauri::command(async)]
fn pack_copy(dir: String, file: String, design: String, preview_base64: Option<String>, pictures: Vec<String>, history: bool, conversation: bool) -> Result<(), String> {
    use base64::Engine;
    let _turn = file_turn();
    let preview = match preview_base64 {
        Some(text) => Some(base64::engine::general_purpose::STANDARD.decode(text.trim()).map_err(|e| format!("The picture data was not valid: {e}"))?),
        None => None,
    };
    package::pack_copy(Path::new(&dir), Path::new(&file), &design, preview.as_deref(), &pictures, &package::CopyChoice { history, conversation })
}

/// Unpack a project file into its working folder, and say where it went.
#[tauri::command(async)]
fn unpack_project(file: String) -> Result<String, String> {
    let _turn = file_turn();
    let dir = package::work_dir_for_file(&file)?;
    // a crash can leave the working copy newer than the file: keep that one, the next save packs it
    let design = dir.join(DESIGN_FILE);
    let newer = match (fs::metadata(&design).and_then(|m| m.modified()), fs::metadata(&file).and_then(|m| m.modified())) {
        (Ok(w), Ok(f)) => w > f + std::time::Duration::from_secs(3),
        _ => false,
    };
    if !newer {
        package::unpack(Path::new(&file), &dir)?;
    }
    Ok(dir.to_string_lossy().to_string())
}

/// Is this a folder (an older project) or a single file?
#[tauri::command]
fn is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}

/// The project file Duet was asked to open when it started, if any (double-click on Windows).
#[tauri::command]
fn launch_file() -> Option<String> {
    std::env::args().skip(1).find(|a| a.to_lowercase().ends_with(".duet") && Path::new(a).exists())
}

/// The names of every font family installed on this computer, in order, each once.
#[tauri::command(async)]
fn system_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut names: Vec<String> = db
        .faces()
        .filter_map(|f| f.families.first().map(|(name, _)| name.clone()))
        // Mac keeps fonts for its own interface under names that start with a dot
        .filter(|n| !n.is_empty() && !n.starts_with('.'))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

/// The one folder where new projects go by default: Documents/Duet. Made if it is missing.
#[tauri::command]
fn default_projects_dir() -> Result<String, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not find your home folder.".to_string())?;
    let dir = Path::new(&home).join("Documents").join("Duet");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.to_string_lossy().to_string())
}

#[derive(Serialize)]
struct FoundProject {
    path: String,
    /// When the design was last saved, in milliseconds.
    modified: u64,
}

/// Look inside a folder, a few levels down, for Duet project files (.duet).
#[tauri::command(async)]
fn find_projects(root: String) -> Vec<FoundProject> {
    fn walk(dir: &Path, depth: u32, out: &mut Vec<FoundProject>) {
        if depth > 3 {
            return;
        }
        let Ok(read) = fs::read_dir(dir) else { return };
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if entry.path().is_file() && name.to_lowercase().ends_with(".duet") {
                let modified = fs::metadata(entry.path())
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                out.push(FoundProject { path: entry.path().to_string_lossy().to_string(), modified });
                continue;
            }
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "Library" {
                continue;
            }
            if entry.path().is_dir() {
                walk(&entry.path(), depth + 1, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(Path::new(&root), 0, &mut out);
    out
}

#[derive(Serialize)]
struct DirEntryInfo {
    name: String,
    is_dir: bool,
}

/// List the entries of a folder. Used to import skills that come as folders.
#[tauri::command(async)]
fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| format!("Could not read {path}: {e}"))?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        out.push(DirEntryInfo { is_dir: entry.path().is_dir(), name });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[derive(Serialize)]
struct UserSkill {
    id: String,
    body: String,
}

fn skill_file(id: &str) -> Result<std::path::PathBuf, String> {
    let ok = !id.is_empty()
        && id.len() <= 60
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !ok {
        return Err("A skill name can use lowercase letters, numbers and dashes.".to_string());
    }
    let dir = duet_home_dir()?.join("skills");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join(format!("{id}.md")))
}

#[tauri::command]
fn list_user_skills() -> Result<Vec<UserSkill>, String> {
    let dir = duet_home_dir()?.join("skills");
    let mut out = Vec::new();
    if let Ok(read) = fs::read_dir(&dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string()) else {
                continue;
            };
            if let Ok(body) = fs::read_to_string(&path) {
                out.push(UserSkill { id, body });
            }
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
fn write_user_skill(id: String, body: String) -> Result<(), String> {
    fs::write(skill_file(&id)?, body).map_err(err)
}

#[tauri::command]
fn delete_user_skill(id: String) -> Result<(), String> {
    let f = skill_file(&id)?;
    if f.exists() {
        fs::remove_file(f).map_err(err)?;
    }
    Ok(())
}

// ---------- history ----------
// Git runs inside the app (libgit2), so designers never need to install it.
// The words "commit" and "tag" never reach the interface.

const DESIGN_FILE: &str = "design.json";

fn open_or_init(path: &str) -> Result<Repository, String> {
    match Repository::open(path) {
        Ok(r) => Ok(r),
        Err(_) => Repository::init(path).map_err(err),
    }
}

fn signature(repo: &Repository) -> Result<Signature<'static>, String> {
    match repo.signature() {
        Ok(s) => Ok(s.to_owned()),
        Err(_) => Signature::now("Duet", "duet@localhost").map_err(err),
    }
}

/// Make sure the project folder has a history store.
#[tauri::command(async)]
fn git_prepare(path: String) -> Result<(), String> {
    open_or_init(&path).map(|_| ())
}

/// Record the current design.json as a new step. Returns false if nothing changed.
#[tauri::command(async)]
fn git_commit(path: String, message: String) -> Result<bool, String> {
    let _turn = file_turn();
    let repo = open_or_init(&path)?;
    let mut index = repo.index().map_err(err)?;
    index.add_path(Path::new(DESIGN_FILE)).map_err(err)?;
    index.write().map_err(err)?;
    let tree_id = index.write_tree().map_err(err)?;
    let tree = repo.find_tree(tree_id).map_err(err)?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if let Some(p) = &parent {
        if p.tree_id() == tree_id {
            return Ok(false);
        }
    }
    let sig = signature(&repo)?;
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(err)?;
    Ok(true)
}

#[derive(Serialize)]
struct HistoryItem {
    hash: String,
    time: i64,
    label: String,
    actor: String,
    /// Which AI tool made the step, when it said who it is.
    by: Option<String>,
    doc: String,
    versions: Vec<String>,
    /// The names of the steps saved here, its own name last. Empty for steps saved before they had names.
    steps: Vec<String>,
    /// The step it was made on, when it started a new direction.
    from: Option<String>,
}

/// The saved steps of a project, oldest first, each with the design as it was then.
#[tauri::command(async)]
fn git_history(path: String, limit: usize) -> Result<Vec<HistoryItem>, String> {
    let repo = match Repository::open(&path) {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };
    if repo.head().is_err() {
        return Ok(vec![]);
    }

    // named versions, keyed by the commit they point at
    let mut named: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    let names = repo.tag_names(None).map_err(err)?;
    for raw in names.iter_bytes() {
        let name = String::from_utf8_lossy(raw).to_string();
        let reference = match repo.find_reference(&format!("refs/tags/{name}")) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let commit = match reference.peel_to_commit() {
            Ok(c) => c,
            Err(_) => continue,
        };
        let title = reference
            .peel_to_tag()
            .ok()
            .and_then(|t| t.message().ok().flatten().map(|m| m.trim().to_string()))
            .unwrap_or_else(|| name.clone());
        named.entry(commit.id()).or_default().push(title);
    }

    let mut walk = repo.revwalk().map_err(err)?;
    walk.push_head().map_err(err)?;
    walk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)
        .map_err(err)?;

    let mut items = Vec::new();
    for oid in walk.take(limit) {
        let oid = oid.map_err(err)?;
        let commit = repo.find_commit(oid).map_err(err)?;
        let message = commit.message().unwrap_or("").to_string();
        let mut lines = message.lines();
        let label = lines.next().unwrap_or("").trim().to_string();
        let actor = if message.lines().any(|l| l.trim() == "Actor: ai") {
            "ai"
        } else {
            "you"
        };
        let tree = commit.tree().map_err(err)?;
        let entry = match tree.get_path(Path::new(DESIGN_FILE)) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let blob = match entry.to_object(&repo).and_then(|o| o.peel_to_blob()) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let doc = String::from_utf8_lossy(blob.content()).to_string();
        items.push(HistoryItem {
            hash: oid.to_string(),
            time: commit.time().seconds(),
            label,
            actor: actor.to_string(),
            by: message.lines().find_map(|l| l.trim().strip_prefix("By:")).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            doc,
            versions: named.get(&oid).cloned().unwrap_or_default(),
            steps: message.lines().find_map(|l| l.trim().strip_prefix("Steps:")).map(|s| s.split_whitespace().map(String::from).collect()).unwrap_or_default(),
            from: message.lines().find_map(|l| l.trim().strip_prefix("From:")).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        });
    }
    items.reverse();
    Ok(items)
}

/// Give the latest saved step a name, like "Client round 1".
#[tauri::command(async)]
fn git_name_version(path: String, tag: String, title: String) -> Result<(), String> {
    let repo = open_or_init(&path)?;
    let target = repo
        .head()
        .map_err(err)?
        .peel(git2::ObjectType::Commit)
        .map_err(err)?;
    let sig = signature(&repo)?;
    repo.tag(&tag, &target, &sig, &title, false)
        .map_err(err)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub use ai::bridge;

/// A thing that goes wrong on a background thread should stop that one job, not the whole app, and it should leave a note
/// in `crash.log` beside the session file, so the cause can be found when a designer says Duet quit.
fn note_panics() {
    std::panic::set_hook(Box::new(|info| {
        use std::io::Write;
        let thread = std::thread::current();
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let said = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        let line = format!("{} thread {} at {}: {}\n", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0), thread.name().unwrap_or("unnamed"), place, said);
        eprint!("{line}");
        if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
            let dir = std::path::Path::new(&home).join(duet_dir_name());
            if fs::create_dir_all(&dir).is_ok() {
                if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join("crash.log")) {
                    let _ = f.write_all(line.as_bytes());
                }
            }
        }
    }));
}

pub fn run() {
    note_panics();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // new versions arrive signed with Duet's own key, and Duet restarts into them
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            ai::agy_connect,
            ai::agent_models,
            read_text_file,
            read_binary_file,
            default_projects_dir,
            system_fonts,
            work_dir_for,
            fresh_work_dir,
            pack_project,
            pack_copy,
            unpack_project,
            is_directory,
            launch_file,
            find_projects,
            write_text_file,
            write_binary_file,
            psd::psd_read,
            psd::psd_write,
            path_exists,
            move_project,
            copy_project,
            make_dir,
            duet_home,
            check_copy,
            list_dir,
            list_user_skills,
            write_user_skill,
            delete_user_skill,
            git_prepare,
            git_commit,
            git_history,
            git_name_version,
            video::video_ready,
            video::video_info,
            video::clip_preview,
            video::clip_strip,
            video::clip_peaks,
            grade::look_keep,
            grade::look_read,
            grade::looks_list,
            video::video_export,
            video::clip_keep_begin,
            video::clip_keep_part,
            video::clip_keep_end,
            video::scene_export_begin,
            video::scene_export_frame,
            video::scene_export_clip,
            video::scene_export_end,
            video::scene_export_stop,
            ai::mcp_info,
            ai::mcp_reply,
            ai::mcp_ready,
            ai::bridge_command,
            ai::write_agent_files,
            ai::write_agent_file,
            ai::agent_available,
            ai::agent_run,
            ai::agent_cancel,
            keepalive::keep_running_for_ai,
            keepalive::bring_back,
            trash::trash_project,
            trash::trash_list,
            trash::trash_restore,
            trash::trash_delete
        ])
        .setup(|app| {
            if is_check_copy() {
                use tauri::Manager;
                for window in app.webview_windows().values() {
                    let _ = window.set_title("Duet dev");
                }
            }
            ai::start(app.handle()).map_err(|e| format!("Could not start the agent bridge: {e}"))?;
            // the window starts hidden; it stays hidden only when an AI opened Duet to work in it
            if keepalive::started_for_ai() {
                keepalive::run_hidden(app.handle());
            } else {
                keepalive::show_window(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Duet")
        .run(|app, event| {
            // Every build made for development shows an orange ring in the Dock, so it is never
            // taken for the Duet a designer works in. Set here, after Tauri has set its own.
            #[cfg(all(debug_assertions, target_os = "macos"))]
            if let tauri::RunEvent::Ready = &event {
                use objc2::{AllocAnyThread, MainThreadMarker};
                use objc2_app_kit::{NSApplication, NSImage};
                use objc2_foundation::NSData;
                if let Some(mtm) = MainThreadMarker::new() {
                    let data = NSData::with_bytes(include_bytes!("../icons/dev.png"));
                    if let Some(icon) = NSImage::initWithData(NSImage::alloc(), &data) {
                        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&icon)) };
                    }
                }
            }
            // a project file opened from Finder while Duet is already running
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = &event {
                use tauri::Emitter;
                for u in urls {
                    if let Ok(p) = u.to_file_path() {
                        let _ = app.emit("open-file", p.to_string_lossy().to_string());
                    }
                }
            }
            // quitting on purpose while an AI is mid-change asks first; the window closing never gets here
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = &event {
                if keepalive::hold_quit(app) {
                    api.prevent_exit();
                }
            }
            // the Dock icon clicked while the window is hidden
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &event {
                keepalive::show_window(app);
            }
            if let tauri::RunEvent::Exit = &event {
                ai::stop_agent(app);
            }
            let _ = (&app, &event);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_the_computers_fonts() {
        let fonts = system_fonts();
        // every Mac and Windows computer has Arial
        assert!(fonts.iter().any(|f| f == "Arial"), "{} fonts, no Arial", fonts.len());
        assert!(fonts.windows(2).all(|w| w[0].to_lowercase() <= w[1].to_lowercase()));
        assert!(!fonts.iter().any(|f| f.starts_with('.')));
    }

    fn project(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("duet-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().to_string()
    }

    fn write(path: &str, text: &str) {
        write_text_file(format!("{path}/design.json"), text.to_string()).unwrap();
    }

    #[test]
    fn keeps_steps_and_who_made_them() {
        let p = project("steps");
        write(&p, "{\"n\":1}");
        git_prepare(p.clone()).unwrap();
        assert!(git_commit(p.clone(), "Start of project\n\nActor: you".into()).unwrap());
        write(&p, "{\"n\":2}");
        assert!(git_commit(p.clone(), "Add rectangle\n\nActor: ai\nBy: Claude Code".into()).unwrap());

        let h = git_history(p.clone(), 50).unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].label, "Start of project");
        assert_eq!(h[0].actor, "you");
        assert_eq!(h[0].doc, "{\"n\":1}");
        assert_eq!(h[1].label, "Add rectangle");
        assert_eq!(h[1].actor, "ai");
        assert_eq!(h[1].by.as_deref(), Some("Claude Code"));
        assert_eq!(h[0].by, None);
        assert_eq!(h[1].doc, "{\"n\":2}");
    }

    #[test]
    fn hands_back_the_names_of_the_steps_saved_together() {
        let p = project("names");
        write(&p, "{\"n\":1}");
        git_prepare(p.clone()).unwrap();
        // a step saved before steps had names
        assert!(git_commit(p.clone(), "Start of project\n\nActor: you".into()).unwrap());
        write(&p, "{\"n\":2}");
        assert!(git_commit(p.clone(), "Move logo\n\nActor: ai\nSteps: aaaaaa bbbbbb".into()).unwrap());

        let h = git_history(p.clone(), 50).unwrap();
        assert!(h[0].steps.is_empty());
        assert_eq!(h[1].steps, vec!["aaaaaa", "bbbbbb"]);
        assert_eq!(h[1].actor, "ai");
        assert_eq!(h[1].label, "Move logo");
    }

    #[test]
    fn does_not_record_an_unchanged_design() {
        let p = project("same");
        write(&p, "{}");
        assert!(git_commit(p.clone(), "one".into()).unwrap());
        assert!(!git_commit(p.clone(), "two".into()).unwrap());
        assert_eq!(git_history(p, 50).unwrap().len(), 1);
    }

    #[test]
    fn names_a_version_and_finds_it_again() {
        let p = project("version");
        write(&p, "{\"n\":1}");
        git_commit(p.clone(), "first".into()).unwrap();
        git_name_version(p.clone(), "v1-client-round-1".into(), "Client round 1".into()).unwrap();
        write(&p, "{\"n\":2}");
        git_commit(p.clone(), "second".into()).unwrap();

        let h = git_history(p, 50).unwrap();
        assert_eq!(h[0].versions, vec!["Client round 1".to_string()]);
        assert!(h[1].versions.is_empty());
    }

    #[test]
    fn empty_project_has_no_history() {
        let p = project("empty");
        assert!(git_history(p.clone(), 10).unwrap().is_empty());
        git_prepare(p.clone()).unwrap();
        assert!(git_history(p, 10).unwrap().is_empty());
    }

    #[test]
    fn writes_files_without_leaving_temp_files() {
        let p = project("atomic");
        write(&p, "hello");
        assert_eq!(read_text_file(format!("{p}/design.json")).unwrap(), "hello");
        assert!(!Path::new(&format!("{p}/design.json.tmp")).exists());
    }
}
