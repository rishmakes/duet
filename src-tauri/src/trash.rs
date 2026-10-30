//! Duet's own trash. A project moved here is not deleted: it waits 30 days, can be put back, and
//! is cleared out after that. Each one is a file plus a small note saying where it came from.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const KEEP_MS: u64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Serialize, Deserialize, Clone)]
pub struct TrashItem {
    pub id: String,
    pub name: String,
    pub original: String,
    /// When it was moved here, in milliseconds.
    pub trashed: u64,
    /// Where it waits in the trash, so its picture can be shown. Not kept in the note.
    #[serde(default, skip_deserializing)]
    pub file: String,
}

fn err(e: std::io::Error) -> String {
    e.to_string()
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn root() -> Result<PathBuf, String> {
    let dir = super::duet_home_dir()?.join("trash");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

fn note_of(root: &Path, id: &str) -> PathBuf {
    root.join(format!("{id}.json"))
}

/// Move a file, even across drives.
fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to).map_err(err)?;
    fs::remove_file(from).map_err(err)
}

fn move_in(root: &Path, file: &Path, at: u64) -> Result<TrashItem, String> {
    let name = file.file_name().ok_or("That is not a project file.")?.to_string_lossy().to_string();
    if !file.is_file() {
        return Err("That project file is not there any more.".into());
    }
    let id = format!("{at}-{name}");
    move_file(file, &root.join(&id))?;
    let item = TrashItem { id: id.clone(), name: name.trim_end_matches(".duet").to_string(), original: file.to_string_lossy().to_string(), trashed: at, file: String::new() };
    fs::write(note_of(root, &id), serde_json::to_string(&item).map_err(|e| e.to_string())?).map_err(err)?;
    Ok(item)
}

fn delete_in(root: &Path, id: &str) -> Result<(), String> {
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("That is not something in the trash.".into());
    }
    let _ = fs::remove_file(root.join(id));
    let _ = fs::remove_file(note_of(root, id));
    Ok(())
}

/// What is in the trash, newest first. Anything older than 30 days is cleared out on the way.
fn list_in(root: &Path, at: u64) -> Vec<TrashItem> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(root) else { return out };
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(item) = fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str::<TrashItem>(&t).ok()) else { continue };
        if at.saturating_sub(item.trashed) > KEEP_MS {
            let _ = delete_in(root, &item.id);
        } else if root.join(&item.id).is_file() {
            let file = root.join(&item.id).to_string_lossy().to_string();
            out.push(TrashItem { file, ..item });
        }
    }
    out.sort_by(|a, b| b.trashed.cmp(&a.trashed));
    out
}

/// Put one back where it was. If that place is taken, it comes back beside it with a number.
fn restore_in(root: &Path, id: &str) -> Result<String, String> {
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("That is not something in the trash.".into());
    }
    let item = fs::read_to_string(note_of(root, id)).ok().and_then(|t| serde_json::from_str::<TrashItem>(&t).ok()).filter(|_| root.join(id).is_file()).ok_or("That is not in the trash any more.")?;
    let original = PathBuf::from(&item.original);
    if let Some(parent) = original.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let stem = original.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| item.name.clone());
    let mut target = original.clone();
    let mut n = 1;
    while target.exists() {
        n += 1;
        target = original.with_file_name(format!("{stem} {n}.duet"));
    }
    move_file(&root.join(id), &target)?;
    let _ = fs::remove_file(note_of(root, id));
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn trash_project(path: String) -> Result<(), String> {
    move_in(&root()?, Path::new(&path), now()).map(|_| ())
}

#[tauri::command(async)]
pub fn trash_list() -> Vec<TrashItem> {
    root().map(|r| list_in(&r, now())).unwrap_or_default()
}

#[tauri::command(async)]
pub fn trash_restore(id: String) -> Result<String, String> {
    restore_in(&root()?, &id)
}

#[tauri::command(async)]
pub fn trash_delete(id: String) -> Result<(), String> {
    delete_in(&root()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("duet-trash-{tag}-{}", now()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_trashed_project_can_be_put_back() {
        let dir = scratch("back");
        let (bin, work) = (dir.join("bin"), dir.join("work"));
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&work).unwrap();
        let file = work.join("Poster.duet");
        fs::write(&file, "x").unwrap();
        move_in(&bin, &file, 1000).unwrap();
        assert!(!file.exists());
        let items = list_in(&bin, 2000);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Poster");
        assert!(Path::new(&items[0].file).is_file());
        let back = restore_in(&bin, &items[0].id).unwrap();
        assert_eq!(back, file.to_string_lossy());
        assert!(file.exists());
        assert!(list_in(&bin, 3000).is_empty());
    }

    #[test]
    fn restoring_never_replaces_a_file_that_took_its_place() {
        let dir = scratch("taken");
        let (bin, work) = (dir.join("bin"), dir.join("work"));
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&work).unwrap();
        let file = work.join("Logo.duet");
        fs::write(&file, "old").unwrap();
        let item = move_in(&bin, &file, now()).unwrap();
        fs::write(&file, "new").unwrap();
        let back = restore_in(&bin, &item.id).unwrap();
        assert!(back.ends_with("Logo 2.duet"));
        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
        assert_eq!(fs::read_to_string(&back).unwrap(), "old");
    }

    #[test]
    fn the_trash_clears_out_after_thirty_days() {
        let dir = scratch("old");
        let (bin, work) = (dir.join("bin"), dir.join("work"));
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&work).unwrap();
        let file = work.join("Old.duet");
        fs::write(&file, "x").unwrap();
        let item = move_in(&bin, &file, 1000).unwrap();
        assert_eq!(list_in(&bin, 1000 + KEEP_MS).len(), 1);
        assert!(list_in(&bin, 1000 + KEEP_MS + 1).is_empty());
        assert!(!bin.join(&item.id).exists());
    }
}
