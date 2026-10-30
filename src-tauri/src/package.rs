//! A Duet project as one file.
//!
//! A `.duet` file is a zip holding everything a project is: the design, its pictures, its preview and
//! its whole history. While you work, Duet keeps an unpacked copy in its own folder (~/.duet/work), and
//! packs it back into your file every time you save. Nothing about the history or the design changes.

use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn work_root() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not find your home folder.".to_string())?;
    let dir = Path::new(&home).join(crate::duet_dir_name()).join("work");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// The working folder for a project file. The same file always gets the same folder.
pub fn work_dir_for_file(file: &str) -> Result<PathBuf, String> {
    let mut h = DefaultHasher::new();
    file.hash(&mut h);
    let name = Path::new(file).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "project".into());
    let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    Ok(work_root()?.join(format!("{safe}-{:016x}", h.finish())))
}

fn already_compressed(name: &str) -> bool {
    let n = name.to_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".gif", ".zip"].iter().any(|e| n.ends_with(e)) || n.contains("/objects/pack/")
}

fn add_dir(zip: &mut ZipWriter<File>, root: &Path, dir: &Path) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(err)?.flatten() {
        let path = entry.path();
        let rel = path.strip_prefix(root).map_err(err)?.to_string_lossy().replace('\\', "/");
        if rel.ends_with(".tmp") {
            continue;
        }
        if path.is_dir() {
            zip.add_directory(format!("{rel}/"), SimpleFileOptions::default()).map_err(err)?;
            add_dir(zip, root, &path)?;
        } else {
            let method = if already_compressed(&rel) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
            zip.start_file(rel, SimpleFileOptions::default().compression_method(method)).map_err(err)?;
            let mut f = File::open(&path).map_err(err)?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(err)?;
            zip.write_all(&buf).map_err(err)?;
        }
    }
    Ok(())
}

/// Pack a project folder into one file. Written beside it first, then swapped in, so a crash never
/// leaves half a file behind.
pub fn pack(dir: &Path, file: &Path) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let tmp = PathBuf::from(format!("{}.tmp", file.to_string_lossy()));
    {
        let out = File::create(&tmp).map_err(err)?;
        let mut zip = ZipWriter::new(out);
        add_dir(&mut zip, dir, dir)?;
        zip.finish().map_err(err)?;
    }
    fs::rename(&tmp, file).map_err(err)
}

/// What a copy of a project carries besides the design as it is now.
pub struct CopyChoice {
    /// The earlier steps and the named versions.
    pub history: bool,
    /// The conversation with the AI.
    pub conversation: bool,
}

/// A picture named by a design: one plain file inside `assets/`, nothing that climbs out.
fn picture_name(src: &str) -> Option<&str> {
    let name = src.strip_prefix("assets/")?;
    let plain = !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':']);
    plain.then_some(name)
}

fn add_file(zip: &mut ZipWriter<File>, rel: &str, bytes: &[u8]) -> Result<(), String> {
    let method = if already_compressed(rel) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
    zip.start_file(rel, SimpleFileOptions::default().compression_method(method)).map_err(err)?;
    zip.write_all(bytes).map_err(err)
}

/// Make a second project file to hand to someone else. It is built from a list of what to keep, so
/// anything a project learns to hold later stays out until it is added here on purpose. The working
/// folder is only read.
pub fn pack_copy(dir: &Path, file: &Path, design: &str, preview: Option<&[u8]>, pictures: &[String], choice: &CopyChoice) -> Result<(), String> {
    if file.starts_with(dir) {
        return Err("A copy cannot be saved inside the project it is made from.".to_string());
    }
    let names: Vec<&str> = pictures.iter().map(|p| picture_name(p).ok_or_else(|| format!("{p} is not a picture of this project."))).collect::<Result<_, _>>()?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let tmp = PathBuf::from(format!("{}.tmp", file.to_string_lossy()));
    let write = || -> Result<(), String> {
        let mut zip = ZipWriter::new(File::create(&tmp).map_err(err)?);
        add_file(&mut zip, "design.json", design.as_bytes())?;
        if let Some(bytes) = preview {
            add_file(&mut zip, "preview.png", bytes)?;
        }
        if choice.history {
            // earlier steps need the pictures they used, so every picture goes along
            for part in [".git", "assets"] {
                if dir.join(part).is_dir() {
                    zip.add_directory(format!("{part}/"), SimpleFileOptions::default()).map_err(err)?;
                    add_dir(&mut zip, dir, &dir.join(part))?;
                }
            }
        } else if !names.is_empty() {
            zip.add_directory("assets/", SimpleFileOptions::default()).map_err(err)?;
            for name in &names {
                // a picture that has gone missing leaves an empty box, the same as in the project itself
                if let Ok(bytes) = fs::read(dir.join("assets").join(name)) {
                    add_file(&mut zip, &format!("assets/{name}"), &bytes)?;
                }
            }
        }
        if choice.conversation {
            if let Ok(bytes) = fs::read(dir.join("memory").join("thread.json")) {
                zip.add_directory("memory/", SimpleFileOptions::default()).map_err(err)?;
                add_file(&mut zip, "memory/thread.json", &bytes)?;
            }
        }
        zip.finish().map_err(err)?;
        Ok(())
    };
    if let Err(e) = write() {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    fs::rename(&tmp, file).map_err(err)
}

/// Said when a project's file is no longer where Duet last kept it. The file is not written back there.
pub const LOST: &str = "The project file is no longer where it was.";

/// Pack a project into the file it already has. If that file has gone, renamed, moved or deleted
/// outside Duet, nothing is written: writing would bring back a file the designer took away.
pub fn pack_existing(dir: &Path, file: &Path) -> Result<(), String> {
    if !file.is_file() {
        return Err(LOST.to_string());
    }
    pack(dir, file)
}

/// Take a project's working folder along when its file moves, so a new project under the old name
/// never clears it. A folder already waiting under the new name is put aside, never deleted.
pub fn move_work_dir(from_file: &str, to_file: &str) -> Result<PathBuf, String> {
    let (a, b) = (work_dir_for_file(from_file)?, work_dir_for_file(to_file)?);
    if a.exists() && a != b {
        if b.exists() {
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            fs::rename(&b, PathBuf::from(format!("{}-aside-{stamp}", b.to_string_lossy()))).map_err(err)?;
        }
        fs::rename(&a, &b).map_err(err)?;
    }
    Ok(b)
}

/// What a project's history says about it: the step it is at, and every step it has been at.
pub struct History {
    pub head: String,
    pub steps: std::collections::HashSet<String>,
}

/// Read a history from its files, wherever they are kept. `read` gives the text of a file inside the project.
fn history_with(mut read: impl FnMut(&str) -> Option<String>) -> Option<History> {
    let at = read(".git/HEAD")?;
    let at = at.trim();
    let head = match at.strip_prefix("ref: ") {
        Some(name) => match read(&format!(".git/{name}")) {
            Some(h) => h.trim().to_string(),
            None => read(".git/packed-refs")?.lines().find_map(|l| l.strip_suffix(name).map(|h| h.trim().to_string()))?,
        },
        None => at.to_string(),
    };
    if head.is_empty() {
        return None;
    }
    // the history's log names every step it has been at, one line each: before, after, who, what
    let mut steps: std::collections::HashSet<String> = read(".git/logs/HEAD").map(|log| log.lines().filter_map(|l| l.split(' ').nth(1).map(String::from)).collect()).unwrap_or_default();
    steps.insert(head.clone());
    Some(History { head, steps })
}

/// The history of an unpacked working folder.
pub fn history_of_dir(dir: &Path) -> Option<History> {
    history_with(|rel| fs::read_to_string(dir.join(rel)).ok())
}

/// The history inside a project file, read without unpacking it.
pub fn history_of_file(file: &Path) -> Option<History> {
    let mut zip = ZipArchive::new(File::open(file).ok()?).ok()?;
    history_with(|rel| {
        let mut entry = zip.by_name(rel).ok()?;
        let mut text = String::new();
        entry.read_to_string(&mut text).ok()?;
        Some(text)
    })
}

/// Find where a project went, from its working folder. A file whose history holds the step the
/// working folder is at is the same project, gone on as far or further; one whose step the working
/// folder holds is the same project, left behind. One gone on wins; one left behind counts only when
/// it is the only one. Nothing is found when two could be it, so a copy is never taken for the project.
pub fn find_moved(work: &Path, candidates: &[PathBuf]) -> Option<PathBuf> {
    let mine = history_of_dir(work)?;
    let (mut ahead, mut behind) = (Vec::new(), Vec::new());
    for c in candidates {
        let Some(h) = history_of_file(c) else { continue };
        if h.steps.contains(&mine.head) {
            ahead.push(c);
        } else if mine.steps.contains(&h.head) {
            behind.push(c);
        }
    }
    match (ahead.as_slice(), behind.as_slice()) {
        ([one], _) | ([], [one]) => Some((*one).clone()),
        _ => None,
    }
}

/// Unpack a project file into a folder, replacing what was there. Names that try to climb out of the
/// folder are refused.
pub fn unpack(file: &Path, dir: &Path) -> Result<(), String> {
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(err)?;
    }
    fs::create_dir_all(dir).map_err(err)?;
    let mut zip = ZipArchive::new(File::open(file).map_err(|e| format!("Could not open {}: {e}", file.display()))?).map_err(|_| "That file is not a Duet project.".to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(err)?;
        let Some(rel) = entry.enclosed_name() else { continue };
        let target = dir.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(err)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(err)?;
            }
            let mut out = File::create(&target).map_err(err)?;
            std::io::copy(&mut entry, &mut out).map_err(err)?;
        }
    }
    if !dir.join("design.json").is_file() {
        return Err("That file is not a Duet project.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("duet-package-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_project_survives_packing_and_unpacking() {
        let src = temp("src");
        fs::write(src.join("design.json"), "{\"version\":1}").unwrap();
        fs::create_dir_all(src.join("assets")).unwrap();
        fs::write(src.join("assets/pic.png"), [1u8, 2, 3, 4]).unwrap();
        fs::create_dir_all(src.join(".git/objects")).unwrap();
        fs::write(src.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        let file = temp("out").join("p.duet");
        pack(&src, &file).unwrap();
        let back = temp("back");
        unpack(&file, &back).unwrap();
        assert_eq!(fs::read_to_string(back.join("design.json")).unwrap(), "{\"version\":1}");
        assert_eq!(fs::read(back.join("assets/pic.png")).unwrap(), vec![1u8, 2, 3, 4]);
        assert_eq!(fs::read_to_string(back.join(".git/HEAD")).unwrap(), "ref: refs/heads/main\n");
    }

    #[test]
    fn a_file_that_is_not_a_project_is_refused() {
        let junk = temp("junk").join("x.duet");
        fs::write(&junk, "hello").unwrap();
        assert!(unpack(&junk, &temp("dest")).is_err());
        // a zip with no design in it is refused too
        let src = temp("empty");
        fs::write(src.join("readme.txt"), "hi").unwrap();
        let f = temp("o2").join("e.duet");
        pack(&src, &f).unwrap();
        assert!(unpack(&f, &temp("dest2")).is_err());
    }

    /// A working folder with a history, a conversation, a picture in use and one from an earlier idea.
    fn worked_on(name: &str) -> PathBuf {
        let src = temp(name);
        fs::write(src.join("design.json"), "{\"old\":1}").unwrap();
        fs::write(src.join("preview.png"), [9u8, 9]).unwrap();
        fs::create_dir_all(src.join("assets")).unwrap();
        fs::write(src.join("assets/used.png"), [1u8, 2, 3]).unwrap();
        fs::write(src.join("assets/earlier-idea.png"), [7u8, 7, 7]).unwrap();
        fs::create_dir_all(src.join(".git/refs/tags")).unwrap();
        fs::write(src.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(src.join(".git/refs/tags/v1-client-round"), "abc\n").unwrap();
        fs::create_dir_all(src.join("memory")).unwrap();
        fs::write(src.join("memory/thread.json"), "{\"now\":[]}").unwrap();
        fs::write(src.join("memory/notes.json"), "{\"notes\":[]}").unwrap();
        src
    }

    /// Every file under a folder, as sorted relative names with their contents.
    fn listing(root: &Path) -> Vec<(String, Vec<u8>)> {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
            for e in fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(root, &p, out);
                } else {
                    out.push((p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"), fs::read(&p).unwrap()));
                }
            }
        }
        let mut out = Vec::new();
        walk(root, root, &mut out);
        out.sort();
        out
    }

    fn names(root: &Path) -> Vec<String> {
        listing(root).into_iter().map(|(n, _)| n).collect()
    }

    const CLEAN: CopyChoice = CopyChoice { history: false, conversation: false };

    #[test]
    fn a_copy_holds_the_design_as_it_is_now_and_nothing_of_how_it_was_made() {
        let src = worked_on("copy-src");
        let before = listing(&src);
        let file = temp("copy-out").join("for client.duet");
        pack_copy(&src, &file, "{\"now\":2}", Some(&[5u8, 5]), &["assets/used.png".to_string()], &CLEAN).unwrap();
        // it opens like any project
        let back = temp("copy-back");
        unpack(&file, &back).unwrap();
        assert_eq!(names(&back), vec!["assets/used.png", "design.json", "preview.png"]);
        assert_eq!(fs::read_to_string(back.join("design.json")).unwrap(), "{\"now\":2}");
        assert_eq!(fs::read(back.join("preview.png")).unwrap(), vec![5u8, 5]);
        assert_eq!(fs::read(back.join("assets/used.png")).unwrap(), vec![1u8, 2, 3]);
        // and the project it came from is exactly as it was
        assert_eq!(listing(&src), before);
    }

    #[test]
    fn a_copy_can_carry_the_history_or_the_conversation_when_asked() {
        let src = worked_on("copy-full-src");
        let pics = ["assets/used.png".to_string()];
        let with_history = temp("copy-h").join("h.duet");
        pack_copy(&src, &with_history, "{}", None, &pics, &CopyChoice { history: true, conversation: false }).unwrap();
        let h = temp("copy-h-back");
        unpack(&with_history, &h).unwrap();
        assert_eq!(names(&h), vec![".git/HEAD", ".git/refs/tags/v1-client-round", "assets/earlier-idea.png", "assets/used.png", "design.json"]);

        let with_talk = temp("copy-c").join("c.duet");
        pack_copy(&src, &with_talk, "{}", None, &pics, &CopyChoice { history: false, conversation: true }).unwrap();
        let c = temp("copy-c-back");
        unpack(&with_talk, &c).unwrap();
        // the conversation only: nothing else kept in memory goes along
        assert_eq!(names(&c), vec!["assets/used.png", "design.json", "memory/thread.json"]);
    }

    #[test]
    fn a_copy_refuses_names_that_reach_outside_the_pictures() {
        let src = worked_on("copy-bad-src");
        let out = temp("copy-bad-out");
        for bad in ["../secret.txt", "assets/../.git/HEAD", "memory/thread.json", "assets/", "/etc/hosts", "assets/a/b.png"] {
            let file = out.join("bad.duet");
            assert!(pack_copy(&src, &file, "{}", None, &[bad.to_string()], &CLEAN).is_err(), "{bad}");
            assert!(!file.exists());
        }
        assert!(names(&out).is_empty());
        // and it is never written into the project it is made from
        assert!(pack_copy(&src, &src.join("inside.duet"), "{}", None, &[], &CLEAN).is_err());
    }

    #[test]
    fn a_copy_with_a_missing_picture_is_still_made() {
        let src = worked_on("copy-missing-src");
        let file = temp("copy-missing-out").join("m.duet");
        pack_copy(&src, &file, "{}", None, &["assets/gone.png".to_string()], &CLEAN).unwrap();
        let back = temp("copy-missing-back");
        unpack(&file, &back).unwrap();
        assert_eq!(names(&back), vec!["design.json"]);
    }

    #[test]
    fn the_same_file_always_gets_the_same_working_folder() {
        let a = work_dir_for_file("/a/b/Burger Barn.duet").unwrap();
        let b = work_dir_for_file("/a/b/Burger Barn.duet").unwrap();
        let c = work_dir_for_file("/a/c/Burger Barn.duet").unwrap();
        assert_eq!(a, b);
        assert_ne!(a, c);
    }
    /// A working folder with a history at these steps, the last one being where it is.
    fn with_history(name: &str, steps: &[&str]) -> PathBuf {
        let d = temp(name);
        fs::write(d.join("design.json"), "{}").unwrap();
        fs::create_dir_all(d.join(".git/refs/heads")).unwrap();
        fs::create_dir_all(d.join(".git/logs")).unwrap();
        fs::write(d.join(".git/HEAD"), "ref: refs/heads/master\n").unwrap();
        fs::write(d.join(".git/refs/heads/master"), format!("{}\n", steps.last().unwrap())).unwrap();
        let mut log = String::new();
        let mut before = "0000";
        for s in steps {
            log.push_str(&format!("{before} {s} Someone <a@b> 1 +0000\tcommit: step\n"));
            before = s;
        }
        fs::write(d.join(".git/logs/HEAD"), log).unwrap();
        d
    }

    fn packed(name: &str, steps: &[&str]) -> PathBuf {
        let file = temp(&format!("{name}-file")).join(format!("{name}.duet"));
        pack(&with_history(name, steps), &file).unwrap();
        file
    }

    #[test]
    fn a_file_that_has_gone_is_never_written_back() {
        let src = with_history("lost-src", &["a"]);
        let file = temp("lost-out").join("Untitled 29.duet");
        assert_eq!(pack_existing(&src, &file), Err(LOST.to_string()));
        assert!(!file.exists());
        pack(&src, &file).unwrap();
        assert!(pack_existing(&src, &file).is_ok());
    }

    #[test]
    fn a_renamed_project_is_found_by_its_history() {
        let work = with_history("found-work", &["a", "b"]);
        let other = packed("found-other", &["x", "y"]);
        // renamed and then worked on further
        let ahead = packed("found-ahead", &["a", "b", "c"]);
        assert_eq!(find_moved(&work, &[other.clone(), ahead.clone()]), Some(ahead.clone()));
        // renamed with nothing more done to it
        let same = packed("found-same", &["a", "b"]);
        assert_eq!(find_moved(&work, &[other.clone(), same.clone()]), Some(same));
        // renamed before the last step was packed into it
        let behind = packed("found-behind", &["a"]);
        assert_eq!(find_moved(&work, &[other.clone(), behind.clone()]), Some(behind.clone()));
        // gone on further wins over left behind
        assert_eq!(find_moved(&work, &[behind.clone(), ahead.clone()]), Some(ahead.clone()));
        // two that could be it, such as a copy: neither is taken
        let twin = packed("found-twin", &["a", "b", "d"]);
        assert_eq!(find_moved(&work, &[ahead, twin]), None);
        // went its own way after a shared start: not this project
        let apart = packed("found-apart", &["a", "e"]);
        assert_eq!(find_moved(&work, &[other, apart]), None);
    }

    #[test]
    fn a_history_kept_in_packed_refs_is_read_too() {
        let d = with_history("packed-refs", &["a", "b"]);
        fs::remove_file(d.join(".git/refs/heads/master")).unwrap();
        fs::write(d.join(".git/packed-refs"), "# pack-refs\nb refs/heads/master\n").unwrap();
        assert_eq!(history_of_dir(&d).unwrap().head, "b");
    }
}

