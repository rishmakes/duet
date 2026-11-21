//! Voice to text, a plugin from the Store made by Duet.
//!
//! The speech model is OpenAI's Whisper (MIT), in the files the whisper.cpp project publishes on
//! Hugging Face. Duet downloads one size the designer picks, from one fixed version of those files,
//! and only keeps it when its SHA-256 matches the one written here. The engine, whisper.cpp, is built
//! into Duet. It runs in a helper process of its own (`duet-app --transcribe`), so a model that runs
//! out of memory or crashes never takes the design down with it.
//!
//! The words belong to the recording, not to a clip: one file is heard once, and every clip cut from
//! it reads its words from the same list.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// One size the designer can pick.
pub struct Model {
    pub size: &'static str,
    pub file: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

/// The version of the whisper.cpp model files Duet asks for. A new version is a deliberate change here.
const COMMIT: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";

pub const MODELS: [Model; 4] = [
    Model { size: "light", file: "ggml-small-q5_1.bin", bytes: 190_085_487, sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb" },
    Model { size: "small", file: "ggml-large-v3-turbo-q5_0.bin", bytes: 574_041_195, sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2" },
    Model { size: "medium", file: "ggml-large-v3-turbo.bin", bytes: 1_624_555_275, sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69" },
    Model { size: "large", file: "ggml-large-v3.bin", bytes: 3_095_033_483, sha256: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2" },
];

/// One stop on the slider in Voice to text settings, fastest to most accurate (#364).
/// The designer never sees the model or the search. Picked on Rish's own Hinglish recordings, 17 Nov:
/// the quickest search on the light model dropped the second half of a 3 minute clip, so even Fastest
/// keeps a small search; the light model with the wide search heard all of it, sooner than the big turbo.
/// Each stop up is a bigger download or a more careful search (Rish, 17 Nov: the sizes must climb).
/// The bigger stops are for client work, where a slower, careful pass is worth it.
pub struct Stop {
    pub level: u8,
    /// The models this stop can use, the first one being what it downloads.
    pub models: &'static [&'static str],
    pub search: &'static str,
}

pub const STOPS: [Stop; 5] = [
    Stop { level: 1, models: &["light"], search: "beam2" },
    Stop { level: 2, models: &["light"], search: "beam5" },
    Stop { level: 3, models: &["small"], search: "beam5" },
    Stop { level: 4, models: &["medium"], search: "beam5" },
    Stop { level: 5, models: &["large"], search: "beam5" },
];
const TOP: u8 = 5;

/// The stop Duet suggests and starts on: quick and heard every word of mixed Hinglish.
pub const SUGGESTED: u8 = 2;

fn stop(level: u8) -> &'static Stop {
    STOPS.iter().find(|s| s.level == level).unwrap_or(&STOPS[(SUGGESTED - 1) as usize])
}

fn has(dir: &std::path::Path, size: &str) -> bool {
    model(size).is_some_and(|m| dir.join(m.file).is_file())
}

/// The model file a stop would use now, if one it can use is downloaded and checked.
fn ready_model(level: u8) -> Option<&'static Model> {
    let dir = own_dir().ok()?;
    stop(level).models.iter().find(|s| has(&dir, s)).and_then(|s| model(s))
}

fn level_file() -> Result<PathBuf, String> {
    Ok(own_dir()?.join("stop.txt"))
}

fn read_number(f: PathBuf) -> Option<u8> {
    std::fs::read_to_string(f).ok().and_then(|s| s.trim().parse::<u8>().ok())
}

/// The stop picked in settings. Before anything is picked: what is on this computer says it.
fn level() -> u8 {
    if let Some(l) = level_file().ok().and_then(read_number).filter(|l| (1..=TOP).contains(l)) {
        return l;
    }
    // a pick from the four-stop slider of the first test build: its 4 was the biggest model, now 5
    if let Some(l) = own_dir().ok().map(|d| d.join("level.txt")).and_then(read_number).filter(|l| (1..=4).contains(l)) {
        return if l == 4 { TOP } else { l };
    }
    let Ok(dir) = own_dir() else { return SUGGESTED };
    if has(&dir, "large") {
        5
    } else if has(&dir, "medium") {
        4
    } else if has(&dir, "small") {
        3
    } else {
        SUGGESTED
    }
}

/// Delete every model the picked stop does not use, once the one it uses is ready.
fn prune() {
    let l = level();
    let (Some(keep), Ok(dir)) = (ready_model(l), own_dir()) else { return };
    let _ = std::fs::remove_file(dir.join("speed.json")); // left by the timing test #364 dropped
    for m in MODELS.iter().filter(|m| m.size != keep.size) {
        let _ = std::fs::remove_file(dir.join(m.file));
        let _ = std::fs::remove_file(dir.join(format!("{}.part", m.file)));
    }
}

fn model(size: &str) -> Option<&'static Model> {
    MODELS.iter().find(|m| m.size == size)
}

fn url(m: &Model) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/{COMMIT}/{}", m.file)
}

#[derive(Default)]
pub struct VoiceState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// The size being downloaded, if any.
    downloading: Option<&'static str>,
    /// "downloading" or "checking"
    step: &'static str,
    got: u64,
    error: String,
    curl: Option<Child>,
    /// Bumped on every start and cancel, so an old download never reports into a newer one.
    run: u64,
}

fn own_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map_err(|_| "No home folder found.")?;
    Ok(PathBuf::from(home).join(crate::duet_dir_name()).join("addons").join("voice"))
}


/// Free space where the download goes, in bytes, when the computer says.
fn free_bytes() -> Option<u64> {
    let dir = own_dir().ok()?;
    let mut at = dir.as_path();
    while !at.exists() {
        at = at.parent()?;
    }
    #[cfg(unix)]
    {
        let c = std::ffi::CString::new(at.to_string_lossy().as_bytes()).ok()?;
        let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
            return None;
        }
        #[allow(clippy::unnecessary_cast)]
        Some(s.f_bavail as u64 * s.f_frsize as u64)
    }
    #[cfg(not(unix))]
    {
        let _ = at;
        None
    }
}

fn status_of(app: &AppHandle) -> Value {
    let s = app.state::<Arc<VoiceState>>();
    let i = s.inner.lock().unwrap();
    let l = level();
    json!({
        "level": l,
        "suggested": SUGGESTED,
        "ready": ready_model(l).is_some(),
        // Transcribe works when any stop is ready: the nearest one stands in during a download
        "usable": stop_to_use().is_some(),
        "downloading": i.downloading,
        "step": i.step,
        "got": i.got,
        "total": i.downloading.and_then(model).map(|m| m.bytes),
        "error": i.error,
        "free": free_bytes(),
        // per stop: is it ready now, and how big its download is
        "stops": STOPS.iter().map(|s| json!({
            "level": s.level,
            "ready": ready_model(s.level).is_some(),
            "bytes": model(s.models[0]).map(|m| m.bytes),
        })).collect::<Vec<_>>(),
    })
}

fn report(app: &AppHandle) {
    let _ = app.emit("voice-status", status_of(app));
}

#[tauri::command]
pub fn voice_status(app: AppHandle) -> Value {
    status_of(&app)
}

/// Pick a stop on the slider. It is used from the next Transcribe on. When its model is not on this
/// computer yet, the download starts. A download on its way is never dropped by picking another stop:
/// the pick is refused until it finishes or the designer cancels it (#371). Once the model is ready,
/// the ones no stop picked now needs are deleted, to give the space back.
#[tauri::command]
pub fn voice_set_level(app: AppHandle, level: u8) -> Result<(), String> {
    if !(1..=TOP).contains(&level) {
        return Err("There is no such choice.".into());
    }
    let need = model(stop(level).models[0]).ok_or("There is no such choice.")?;
    let busy = app.state::<Arc<VoiceState>>().inner.lock().unwrap().downloading;
    if busy.is_some() && busy != Some(need.size) {
        return Err("A download is on its way. Let it finish, or cancel it first.".into());
    }
    let f = level_file()?;
    std::fs::create_dir_all(f.parent().ok_or("No folder.")?).map_err(|e| e.to_string())?;
    std::fs::write(&f, level.to_string()).map_err(|e| e.to_string())?;
    if ready_model(level).is_some() {
        prune();
        report(&app);
        return Ok(());
    }
    if busy.is_some() {
        report(&app);
        return Ok(());
    }
    start_download(app, need)
}

fn start_download(app: AppHandle, m: &'static Model) -> Result<(), String> {
    let run = {
        let s = app.state::<Arc<VoiceState>>();
        let mut i = s.inner.lock().unwrap();
        if i.downloading.is_some() {
            return Err("A download is already on its way.".into());
        }
        i.run += 1;
        i.downloading = Some(m.size);
        i.step = "downloading";
        i.got = 0;
        i.error.clear();
        i.run
    };
    report(&app);
    std::thread::spawn(move || {
        let result = download(&app, run, m);
        let s = app.state::<Arc<VoiceState>>();
        {
            let mut i = s.inner.lock().unwrap();
            if i.run != run {
                return;
            }
            i.downloading = None;
            i.curl = None;
            i.step = "";
            if let Err(e) = result {
                i.error = e;
            }
        }
        report(&app);
    });
    Ok(())
}

/// Stop a download and throw away what came so far.
#[tauri::command]
pub fn voice_cancel(app: AppHandle) {
    let child = {
        let s = app.state::<Arc<VoiceState>>();
        let mut i = s.inner.lock().unwrap();
        i.run += 1;
        i.downloading = None;
        i.step = "";
        i.error.clear();
        i.curl.take()
    };
    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
    }
    if let Ok(dir) = own_dir() {
        for m in &MODELS {
            let _ = std::fs::remove_file(dir.join(format!("{}.part", m.file)));
        }
    }
    report(&app);
}

/// Delete the downloaded model and give the space back. Words already made stay with their recordings.
#[tauri::command]
pub fn voice_remove(app: AppHandle) {
    if let Ok(dir) = own_dir() {
        for m in &MODELS {
            let _ = std::fs::remove_file(dir.join(m.file));
        }
    }
    report(&app);
}

fn download(app: &AppHandle, run: u64, m: &'static Model) -> Result<(), String> {
    let dir = own_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if let Some(free) = free_bytes() {
        let have = std::fs::metadata(dir.join(format!("{}.part", m.file))).map(|x| x.len()).unwrap_or(0);
        if free + have < m.bytes + 200 * 1024 * 1024 {
            return Err("There is not enough free space on this computer for this size.".into());
        }
    }
    let part = dir.join(format!("{}.part", m.file));
    let have = std::fs::metadata(&part).map(|x| x.len()).unwrap_or(0);
    if have < m.bytes {
        // -C - carries on from where an earlier download stopped
        let mut c = crate::quiet_command(if cfg!(windows) { "curl.exe" } else { "/usr/bin/curl" });
        c.args(["-fsL", "--proto", "=https", "-A", "Duet", "--retry", "3", "-C", "-", "-o"]).arg(&part).arg(url(m));
        let child = c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|_| "The download could not start.")?;
        {
            let s = app.state::<Arc<VoiceState>>();
            let mut i = s.inner.lock().unwrap();
            if i.run != run {
                let mut child = child;
                let _ = child.kill();
                return Ok(());
            }
            i.curl = Some(child);
        }
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let got = std::fs::metadata(&part).map(|x| x.len()).unwrap_or(0);
            let s = app.state::<Arc<VoiceState>>();
            let finished = {
                let mut i = s.inner.lock().unwrap();
                if i.run != run {
                    return Ok(());
                }
                i.got = got;
                match i.curl.as_mut().map(|c| c.try_wait()) {
                    Some(Ok(Some(status))) => Some(status.success()),
                    Some(Ok(None)) => None,
                    _ => Some(false),
                }
            };
            report(app);
            match finished {
                None => continue,
                Some(true) => break,
                Some(false) => return Err("The download stopped. Check the internet connection and press Download again to carry on.".into()),
            }
        }
    }
    {
        let s = app.state::<Arc<VoiceState>>();
        let mut i = s.inner.lock().unwrap();
        if i.run != run {
            return Ok(());
        }
        i.step = "checking";
        i.got = m.bytes;
    }
    report(app);
    if sha256_file(&part)? != m.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err("The download did not match, so it was not used. Press Download to try again.".into());
    }
    std::fs::rename(&part, dir.join(m.file)).map_err(|e| e.to_string())?;
    // the old model goes once the new one is ready, so Transcribe keeps working while it downloads
    prune();
    Ok(())
}

fn sha256_file(path: &PathBuf) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

// ---------- hearing a recording ----------

/// The stop to hear with now: the picked one, or while its download is on its way, the nearest one
/// that is ready, so Transcribe keeps working.
fn stop_to_use() -> Option<(&'static Stop, &'static Model)> {
    let l = level() as i32;
    let mut order: Vec<&Stop> = STOPS.iter().collect();
    order.sort_by_key(|s| ((s.level as i32 - l).abs(), -(s.level as i32)));
    order.into_iter().find_map(|s| ready_model(s.level).map(|m| (s, m)))
}

/// Words the model would not know are spelled out in the line it is given first, so it writes them
/// right: "Duet" came out as "do it" (Rish, 17 Nov). Only for English, mixed speech and auto-detect: a line
/// in English letters would pull Hindi or Bengali in their own script towards English letters.
fn with_own_words(prompt: String, language: &str) -> String {
    const OWN: &str = "Duet";
    if !prompt.is_empty() {
        format!("{prompt} {OWN}.")
    } else if language == "en" || language == "auto" || language.is_empty() {
        format!("{OWN}.")
    } else {
        prompt
    }
}

/// Turn the speech in a recording into words, each with the second it starts and ends.
/// `language` is a Whisper language code such as "hi", "bn" or "en". `prompt` is a line written the
/// way the words should come out: Hinglish heard as English with a Hinglish line comes out in English letters.
/// How carefully it listens is the stop picked in Voice to text settings.
#[tauri::command(async)]
pub fn voice_transcribe(app: AppHandle, path: String, language: String, prompt: Option<String>) -> Result<Value, String> {
    let (st, m) = stop_to_use().ok_or("Voice to text is not downloaded yet.")?;
    let model_path = own_dir()?.join(m.file);
    let prompt = with_own_words(prompt.unwrap_or_default(), &language);
    let mut answer = listen(&app, &path, &model_path, &language, &prompt, st.search, false)?;
    // on Windows the graphics card listens; if its driver fails, the processor hears it again
    if cfg!(windows) && answer.as_ref().is_none_or(|a| a.get("error").is_some()) {
        answer = listen(&app, &path, &model_path, &language, &prompt, st.search, true)?;
    }
    let mut a = answer.ok_or("Voice to text stopped before it finished. The recording may have no sound, or the computer ran out of memory.")?;
    if let Some(e) = a.get("error").and_then(|e| e.as_str()) {
        return Err(e.to_string());
    }
    a["model"] = json!(m.size);
    a["level"] = json!(st.level);
    a["language"] = json!(language);
    Ok(a)
}

/// One run of the helper: its answer, or nothing if it ended without one. `processor` keeps it off
/// the graphics card.
fn listen(app: &AppHandle, path: &str, model_path: &std::path::Path, language: &str, prompt: &str, search: &str, processor: bool) -> Result<Option<Value>, String> {
    let mut child = crate::quiet_command(std::env::current_exe().map_err(|e| e.to_string())?)
        .arg("--transcribe")
        .arg(model_path)
        .arg(path)
        .arg(language)
        .arg(prompt)
        .arg(search)
        .arg(if processor { "processor" } else { "graphics" })
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Voice to text could not start: {e}"))?;
    hearing().lock().unwrap().insert(path.to_string(), child.id());
    let out = child.stdout.take().ok_or("Voice to text could not start.")?;
    let mut answer: Option<Value> = None;
    // each step and how far it is, so a slow computer never looks stuck
    for line in BufReader::new(out).lines().map_while(Result::ok) {
        if let Some(p) = line.strip_prefix("progress ") {
            let _ = app.emit("voice-progress", json!({ "path": path, "percent": p.trim().parse::<u32>().unwrap_or(0) }));
        } else if let Some(s) = line.strip_prefix("stage ") {
            let _ = app.emit("voice-progress", json!({ "path": path, "stage": s.trim() }));
        } else if let Some(sec) = line.strip_prefix("seconds ") {
            let _ = app.emit("voice-progress", json!({ "path": path, "seconds": sec.trim().parse::<f64>().unwrap_or(0.0) }));
        } else if line.starts_with('{') {
            answer = serde_json::from_str(&line).ok();
        }
    }
    let _ = child.wait();
    if hearing().lock().unwrap().remove(path).is_none() {
        return Err("Stopped.".into());
    }
    Ok(answer)
}

/// The helpers hearing recordings now, by the recording's path, so one can be stopped.
fn hearing() -> &'static std::sync::Mutex<std::collections::HashMap<String, u32>> {
    static RUNNING: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, u32>>> = std::sync::OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

/// Stop hearing a recording. Its words are not kept.
#[tauri::command]
pub fn voice_stop(path: String) {
    let Some(pid) = hearing().lock().unwrap().remove(&path) else { return };
    #[cfg(windows)]
    let _ = crate::quiet_command("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).status();
    #[cfg(not(windows))]
    let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
}

/// One line to the app that runs this helper.
fn say(line: &str) {
    let mut o = std::io::stdout();
    let _ = writeln!(o, "{line}");
    let _ = o.flush();
}

/// The helper process: `duet-app --transcribe <model> <recording> <language> <prompt> <search> <on>`.
/// `search` is "beam2" or "beam5". `on` is "processor" to keep it off the graphics card.
/// Prints "progress N" lines while it works, then one line of JSON: the words, or an error.
pub fn transcribe_main() {
    let args: Vec<String> = std::env::args().collect();
    let at = args.iter().position(|a| a == "--transcribe").unwrap_or(0);
    let get = |n: usize| args.get(at + n).cloned().unwrap_or_default();
    let answer = match hear(&get(1), &get(2), &get(3), &get(4), &get(5), get(6) == "processor") {
        Ok(words) => json!({ "words": words }),
        Err(e) => json!({ "error": e }),
    };
    let mut o = std::io::stdout();
    let _ = writeln!(o, "{answer}");
    let _ = o.flush();
}

/// The sound of a recording as Whisper wants it: one channel, 16,000 numbers a second.
fn sound_of(path: &str) -> Result<Vec<f32>, String> {
    let ffmpeg = crate::video::find("ffmpeg").ok_or("Voice to text needs ffmpeg, which ships with Duet. Reinstall Duet.")?;
    let out = crate::quiet_command(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"])
        .stderr(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() || out.stdout.is_empty() {
        return Err("This recording has no sound Duet can read.".into());
    }
    Ok(out.stdout.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

fn hear(model_path: &str, path: &str, language: &str, prompt: &str, search: &str, processor: bool) -> Result<Vec<Value>, String> {
    use whisper_rs::{DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
    whisper_rs::install_logging_hooks();
    say("stage sound");
    let sound = sound_of(path)?;
    say(&format!("seconds {:.1}", sound.len() as f64 / 16000.0));
    say("stage model");
    // word times come from the model's own attention (DTW), which needs to know which model it is
    let preset = if model_path.contains("turbo") {
        DtwModelPreset::LargeV3Turbo
    } else if model_path.contains("small") {
        DtwModelPreset::Small
    } else {
        DtwModelPreset::LargeV3
    };
    let mut cp = WhisperContextParameters::default();
    cp.use_gpu(!processor);
    cp.dtw_parameters(DtwParameters { mode: DtwMode::ModelPreset { model_preset: preset }, ..Default::default() });
    let ctx = WhisperContext::new_with_params(model_path, cp).map_err(|e| format!("The speech model could not load: {e}"))?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    // the wide search on every stop but Fastest; never the quickest guess, which gives up on whole
    // stretches of mixed speech
    let mut p = FullParams::new(match search {
        "beam2" => SamplingStrategy::BeamSearch { beam_size: 2, patience: -1.0 },
        _ => SamplingStrategy::BeamSearch { beam_size: 5, patience: -1.0 },
    });
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8) as i32;
    p.set_n_threads(threads);
    if !language.is_empty() {
        p.set_language(Some(language));
    }
    // a line written the way the words should come out: Hinglish and Banglish in English letters
    if !prompt.is_empty() {
        p.set_initial_prompt(prompt);
    }
    // each stretch is heard fresh: leaning on the previous text makes Whisper skip or repeat mixed speech
    p.set_no_context(true);
    p.set_print_progress(false);
    p.set_print_realtime(false);
    p.set_print_special(false);
    p.set_print_timestamps(false);
    p.set_token_timestamps(true);
    p.set_progress_callback_safe(|percent: i32| {
        let mut o = std::io::stdout();
        let _ = writeln!(o, "progress {percent}");
        let _ = o.flush();
    });
    say("stage hear");
    state.full(p, &sound).map_err(|e| format!("Voice to text could not finish: {e}"))?;

    // tokens into words: a token that starts with a space starts a new word. A word's bytes are
    // joined before they are read, because one Hindi or Bengali letter can be split over two tokens.
    let eot = ctx.token_eot();
    let mut raw: Vec<(Vec<u8>, f64, f64)> = Vec::new();
    let mut last_text = String::new();
    for seg in state.as_iter() {
        let text = seg.to_str_lossy().map(|t| t.trim().to_string()).unwrap_or_default();
        if !said_in_time(seg.start_timestamp(), seg.end_timestamp(), seg.n_tokens()) || (!text.is_empty() && text == last_text) {
            continue;
        }
        last_text = text;
        let seg_end = seg.end_timestamp() as f64 / 100.0;
        let first = raw.len();
        for i in 0..seg.n_tokens() {
            let Some(tok) = seg.get_token(i) else { continue };
            if tok.token_id() >= eot {
                continue;
            }
            let bytes = tok.to_bytes().unwrap_or(&[]).to_vec();
            if bytes.is_empty() {
                continue;
            }
            let d = tok.token_data();
            let at = if d.t_dtw >= 0 { d.t_dtw } else { d.t0 } as f64 / 100.0;
            if bytes[0] == b' ' || raw.len() == first {
                raw.push((bytes, at, at));
            } else if let Some(w) = raw.last_mut() {
                w.0.extend_from_slice(&bytes);
            }
        }
        // a word runs until the next one starts; the last one in a stretch until the stretch ends
        for k in first..raw.len() {
            let next = raw.get(k + 1).map(|w| w.1).filter(|_| k + 1 < raw.len()).unwrap_or(seg_end);
            raw[k].2 = next.max(raw[k].1);
        }
    }
    let loud = loudness(&sound);
    let mut words = Vec::new();
    let texts: Vec<String> = raw.iter().map(|(b, _, _)| String::from_utf8_lossy(b).trim().to_string()).collect();
    let stuck = stuck_loops(&texts);
    for (k, (_, s, e)) in raw.into_iter().enumerate() {
        let w = texts[k].clone();
        if w.is_empty() || stuck[k] {
            continue;
        }
        let (s, e) = fit_to_sound(&loud, s, e);
        words.push(json!({ "w": w, "s": (s * 100.0).round() / 100.0, "e": (e * 100.0).round() / 100.0 }));
    }
    Ok(words)
}

/// False for a stretch the model wrote more words into than anyone could say in its time, or the
/// same words again: Whisper sometimes repeats itself on a pause, and those words were never said.
fn said_in_time(start_cs: i64, end_cs: i64, tokens: i32) -> bool {
    // about 3 cs per piece of a word is faster than any speech
    (end_cs - start_cs) as f64 >= tokens as f64 * 3.0 - 30.0
}

/// Which words to drop because the model got stuck: the same word more than four times in a row is a
/// loop, not speech. The first of the run stays.
fn stuck_loops(words: &[String]) -> Vec<bool> {
    let mut drop = vec![false; words.len()];
    let mut i = 0;
    while i < words.len() {
        let mut j = i + 1;
        while j < words.len() && words[j] == words[i] {
            j += 1;
        }
        if j - i > 4 {
            drop[i + 1..j].iter_mut().for_each(|d| *d = true);
        }
        i = j;
    }
    drop
}

/// How loud each 10 ms of the sound is, in decibels.
fn loudness(sound: &[f32]) -> Vec<f32> {
    sound
        .chunks(160)
        .map(|c| {
            let ms = c.iter().map(|x| x * x).sum::<f32>() / c.len().max(1) as f32;
            10.0 * ms.max(1e-10).log10()
        })
        .collect()
}

/// Shrink a word to where its sound is: quiet at either end is left out, so a word never spreads
/// over a pause. "Quiet" is measured against this recording's own background, not a fixed level.
fn fit_to_sound(loud: &[f32], s: f64, e: f64) -> (f64, f64) {
    if loud.is_empty() || e <= s {
        return (s, e);
    }
    let mut sorted: Vec<f32> = loud.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let floor = sorted[sorted.len() / 10];
    let quiet = (floor + 15.0).max(-55.0);
    let frame = |t: f64| ((t * 100.0) as usize).min(loud.len() - 1);
    let (mut a, mut b) = (frame(s), frame(e));
    // keep at least 50 ms of every word, so a word that is all quiet is not lost
    while a + 5 < b && loud[a] < quiet {
        a += 1;
    }
    while b > a + 5 && loud[b] < quiet {
        b -= 1;
    }
    (a as f64 / 100.0, ((b + 1) as f64 / 100.0).min(e.max(s)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_stop_downloads_a_pinned_model() {
        assert_eq!(STOPS.iter().map(|s| s.level).collect::<Vec<_>>(), [1, 2, 3, 4, 5]);
        for s in &STOPS {
            assert!(model(s.models[0]).is_some());
            assert!(["beam2", "beam5"].contains(&s.search));
        }
        // slower stops never use a smaller download
        let bytes: Vec<u64> = STOPS.iter().map(|s| model(s.models[0]).unwrap().bytes).collect();
        assert!(bytes.windows(2).all(|w| w[0] <= w[1]));
        assert!((1..=TOP).contains(&SUGGESTED));
        for m in &MODELS {
            assert_eq!(m.sha256.len(), 64);
            assert!(url(m).starts_with("https://huggingface.co/ggerganov/whisper.cpp/resolve/"));
            assert!(url(m).contains(COMMIT));
        }
    }

    #[test]
    fn duet_is_spelled_out_only_where_it_cannot_change_the_script() {
        assert_eq!(with_own_words(String::new(), "en"), "Duet.");
        assert_eq!(with_own_words(String::new(), "hi"), "");
        assert!(with_own_words("Haan yaar, ekdum.".into(), "en").ends_with("Duet."));
    }

    #[test]
    fn drops_words_that_could_not_have_been_said() {
        assert!(said_in_time(2030, 2900, 110));
        assert!(!said_in_time(2026, 2028, 93));
        assert!(said_in_time(0, 20, 9));
    }

    #[test]
    fn a_stuck_loop_keeps_one_word() {
        let w = |list: &[&str]| list.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(stuck_loops(&w(&["haan", "haan", "theek"])), [false, false, false]);
        assert_eq!(stuck_loops(&w(&["a", "x", "x", "x", "x", "x", "x", "b"])), [false, false, true, true, true, true, true, false]);
    }

    #[test]
    fn a_word_shrinks_to_its_sound() {
        // 1 s of quiet, 0.5 s of sound, 1 s of quiet, in 10 ms steps
        let mut loud = vec![-70.0f32; 100];
        loud.extend(vec![-20.0f32; 50]);
        loud.extend(vec![-70.0f32; 100]);
        let (s, e) = fit_to_sound(&loud, 0.2, 2.4);
        assert!((s - 1.0).abs() < 0.011, "{s}");
        assert!((e - 1.5).abs() < 0.011, "{e}");
        // a word that is all quiet keeps a little of itself
        let (s, e) = fit_to_sound(&loud, 0.1, 0.5);
        assert!(e > s);
    }

    #[test]
    fn checks_a_file_with_sha256() {
        let p = std::env::temp_dir().join(format!("duet-voice-{}", uuid::Uuid::new_v4()));
        std::fs::write(&p, b"abc").unwrap();
        assert_eq!(sha256_file(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = std::fs::remove_file(&p);
    }
}
