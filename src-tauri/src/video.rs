//! Cutting video: read what a clip is, and join trimmed clips into one file.
//! The work is done by ffmpeg. Duet carries its own copy next to the app; one installed on the
//! computer is used only when that copy is missing (as while Duet is being built).

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::Mutex;

/// Where a tool such as ffmpeg lives. An app started from the Dock does not get the folders a terminal knows.
fn find(program: &str) -> Option<PathBuf> {
    // the copy that ships with Duet sits next to the app itself
    let mut dirs: Vec<PathBuf> = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.to_path_buf())).into_iter().collect();
    dirs.extend(std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default());
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(d.into());
    }
    let names = if cfg!(windows) { vec![format!("{program}.exe")] } else { vec![program.to_string()] };
    dirs.iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.is_file())
}

const MISSING: &str = "Cutting video needs ffmpeg on this computer. Install it, then open Duet again.";

/// The H.264 encoder settings for a finished video. The ffmpeg that ships with Duet uses the computer's
/// own video chip; a full ffmpeg installed for development may have x264, which is used when present.
/// `quality` is on ffmpeg's crf scale: lower is finer.
fn h264(quality: u32) -> Vec<String> {
    static HAS_X264: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let x264 = *HAS_X264.get_or_init(|| {
        find("ffmpeg")
            .and_then(|f| crate::quiet_command(f).args(["-hide_banner", "-encoders"]).output().ok())
            .is_some_and(|o| String::from_utf8_lossy(&o.stdout).contains("libx264"))
    });
    let crf = quality.clamp(10, 34);
    // the chip's own 1 to 100 quality scale, higher is finer
    let q = (100 - crf * 2).to_string();
    let args: Vec<&str> = if x264 {
        return ["-c:v", "libx264", "-preset", "veryfast", "-crf"].iter().map(|s| s.to_string()).chain([crf.to_string()]).collect();
    } else if cfg!(target_os = "macos") {
        vec!["-c:v", "h264_videotoolbox", "-q:v", &q]
    } else if cfg!(windows) {
        vec!["-c:v", "h264_mf", "-rate_control", "quality", "-quality", &q]
    } else {
        vec!["-c:v", "libx264", "-crf", "20"]
    };
    args.into_iter().map(String::from).collect()
}

/// True when this computer has what cutting video needs.
#[tauri::command(async)]
pub fn video_ready() -> bool {
    find("ffmpeg").is_some()
}

#[derive(Serialize)]
pub struct VideoInfo {
    /// Seconds.
    duration: f64,
    width: u32,
    height: u32,
    sound: bool,
}

fn probe(path: &str) -> Result<VideoInfo, String> {
    let text = describe(path)?;
    parse_info(&text).ok_or_else(|| "That file has no picture in it.".to_string())
}

/// What ffmpeg says about a file when asked to read it and do nothing else. Only ffmpeg ships with
/// Duet, so this stands in for a separate probing tool.
fn describe(path: &str) -> Result<String, String> {
    let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
    let out = crate::quiet_command(ffmpeg).args(["-hide_banner", "-i", path]).output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stderr).to_string();
    if !text.contains("Stream #") {
        return Err("That file could not be read as a video.".into());
    }
    Ok(text)
}

/// Length, picture size and sound, read from ffmpeg's description of a file.
fn parse_info(text: &str) -> Option<VideoInfo> {
    let duration = text.split("Duration: ").nth(1).and_then(|r| r.split(',').next()).and_then(|t| {
        let parts: Vec<f64> = t.trim().split(':').filter_map(|p| p.parse().ok()).collect();
        (parts.len() == 3).then(|| parts[0] * 3600.0 + parts[1] * 60.0 + parts[2])
    });
    let picture = text.lines().find(|l| l.contains("Stream #") && l.contains("Video:") && !l.contains("attached pic"))?;
    // the size is the first "wide x high" pair of plain numbers on the picture line
    let (mut width, mut height) = picture
        .split(|c: char| c == ',' || c == ' ')
        .find_map(|w| {
            let (a, b) = w.split_once('x')?;
            Some((a.parse::<u32>().ok()?, b.parse::<u32>().ok()?))
        })?;
    // a phone clip filmed upright is stored on its side with a note to turn it
    let turned = text
        .split("rotation of ")
        .nth(1)
        .and_then(|r| r.split_whitespace().next())
        .and_then(|n| n.parse::<f64>().ok())
        .unwrap_or(0.0);
    if (turned.abs().round() as i64) % 180 == 90 {
        std::mem::swap(&mut width, &mut height);
    }
    Some(VideoInfo { duration: duration.unwrap_or(0.0), width, height, sound: text.lines().any(|l| l.contains("Stream #") && l.contains("Audio:")) })
}

/// Whether a file has sound in it. Works for a sound file too, which has no picture.
fn has_sound(path: &str) -> Result<bool, String> {
    Ok(describe(path)?.lines().any(|l| l.contains("Stream #") && l.contains("Audio:")))
}

/// What a clip is: how long, how big, and whether it has sound.
#[tauri::command]
pub async fn video_info(path: String) -> Result<VideoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || probe(&path)).await.map_err(|e| e.to_string())?
}

#[derive(Deserialize, Clone)]
pub struct Clip {
    path: String,
    /// Seconds into the file where the part to keep starts and ends.
    start: f64,
    end: f64,
}

/// The ffmpeg arguments that join the kept part of each clip into one file of the given size.
/// Every clip is fitted inside the frame with black around it, so mixed shapes still join.
fn join_args(clips: &[(Clip, bool)], width: u32, height: u32, out: &str) -> Vec<String> {
    let (w, h) = (width - width % 2, height - height % 2);
    let mut args: Vec<String> = vec!["-y".into(), "-hide_banner".into(), "-loglevel".into(), "error".into()];
    let mut graph = String::new();
    for (i, (clip, sound)) in clips.iter().enumerate() {
        let length = (clip.end - clip.start).max(0.05);
        args.extend(["-ss".into(), format!("{:.3}", clip.start.max(0.0)), "-t".into(), format!("{length:.3}"), "-i".into(), clip.path.clone()]);
        graph += &format!("[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}];");
        if *sound {
            graph += &format!("[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}];");
        } else {
            // a silent clip still needs sound of its own length, or the join fails
            graph += &format!("anullsrc=r=48000:cl=stereo,atrim=duration={length:.3}[a{i}];");
        }
    }
    for i in 0..clips.len() {
        graph += &format!("[v{i}][a{i}]");
    }
    graph += &format!("concat=n={}:v=1:a=1[v][a]", clips.len());
    args.extend(["-filter_complex".into(), graph, "-map".into(), "[v]".into(), "-map".into(), "[a]".into()]);
    args.extend(h264(20));
    args.extend(["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"].map(String::from));
    args.push(out.into());
    args
}

/// Join the kept part of each clip, in order, into one video file.
#[tauri::command]
pub async fn video_export(clips: Vec<Clip>, width: u32, height: u32, out: String) -> Result<(), String> {
    if clips.is_empty() {
        return Err("Add a clip first.".into());
    }
    if width < 16 || height < 16 {
        return Err("That size is too small.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
        let mut with_sound = Vec::new();
        for clip in clips {
            let sound = probe(&clip.path)?.sound;
            with_sound.push((clip, sound));
        }
        let done = crate::quiet_command(ffmpeg).args(join_args(&with_sound, width, height, &out)).output().map_err(|e| e.to_string())?;
        if done.status.success() {
            return Ok(());
        }
        let said = String::from_utf8_lossy(&done.stderr);
        let last: Vec<&str> = said.lines().rev().take(3).collect();
        Err(format!("The video could not be made. {}", last.into_iter().rev().collect::<Vec<_>>().join(" ")))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- a clip dropped onto Duet: the window is handed its contents, not where it is ----------

/// The copy being written right now.
static COPYING: Mutex<Option<std::fs::File>> = Mutex::new(None);

#[derive(Serialize)]
pub struct Kept {
    path: String,
    /// True when a file of this name and size was kept before, so nothing has to be copied.
    already: bool,
}

/// Start keeping a dropped clip or sound in the Clips folder beside the projects. Its contents follow
/// with `clip_keep_part`, and `clip_keep_end` finishes it. A video is played from a file, so it needs a place.
#[tauri::command]
pub fn clip_keep_begin(name: String, size: u64) -> Result<Kept, String> {
    let dir = PathBuf::from(crate::default_projects_dir()?).join("Clips");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // only the name itself, never a way out of the folder
    let plain: String = name.rsplit(['/', '\\']).next().unwrap_or("clip").chars().filter(|c| !c.is_control()).collect();
    let plain = if plain.trim().is_empty() || plain.starts_with('.') { format!("clip{plain}") } else { plain };
    let (stem, ext) = match plain.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (plain.clone(), String::new()),
    };
    let mut path = dir.join(&plain);
    let mut n = 2;
    while path.exists() {
        if std::fs::metadata(&path).map(|m| m.len() == size).unwrap_or(false) {
            return Ok(Kept { path: path.to_string_lossy().to_string(), already: true });
        }
        path = dir.join(format!("{stem} {n}{ext}"));
        n += 1;
    }
    let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    *COPYING.lock().map_err(|e| e.to_string())? = Some(file);
    Ok(Kept { path: path.to_string_lossy().to_string(), already: false })
}

/// The next part of the clip being kept.
#[tauri::command]
pub fn clip_keep_part(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("That was not part of a file.".into());
    };
    let mut copying = COPYING.lock().map_err(|e| e.to_string())?;
    copying.as_mut().ok_or("No clip is being kept.")?.write_all(bytes).map_err(|e| e.to_string())
}

/// The whole clip has been handed in.
#[tauri::command]
pub fn clip_keep_end() -> Result<(), String> {
    if let Some(mut file) = COPYING.lock().map_err(|e| e.to_string())?.take() {
        file.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- a frame that plays: its pictures arrive one by one and become one video ----------

#[derive(Deserialize, Clone)]
pub struct Sound {
    path: String,
    /// Seconds into the file where the sound to keep starts.
    from: f64,
    /// The second of the video where it is heard.
    at: f64,
    length: f64,
    /// 0 to 1.
    volume: f64,
    /// How fast the file plays: 2 is twice as fast. `length` is in video time, so the part of the file used is `length * speed`.
    #[serde(default = "one")]
    speed: f64,
}

fn one() -> f64 {
    1.0
}

/// ffmpeg's atempo only takes 0.5 to 100 at a time; a slower speed is a chain of halvings.
fn tempo(speed: f64) -> String {
    let mut left = speed.clamp(0.05, 16.0);
    let mut parts: Vec<String> = Vec::new();
    while left < 0.5 {
        parts.push("atempo=0.5".into());
        left /= 0.5;
    }
    parts.push(format!("atempo={left:.4}"));
    parts.join(",")
}

/// A clip read straight from its file, at full quality, one picture at a time, for the frames where
/// it fills the whole video. Its pictures come out as 16-bit RGB at the video's size.
struct Reader {
    child: Child,
    out: std::process::ChildStdout,
    /// The second in the file of the next picture it will give.
    next: f64,
    /// The size of the pictures it gives.
    size: (u32, u32),
}

/// The video being made right now: ffmpeg waiting for 16-bit pictures, and the clips being read.
struct Making {
    encoder: Child,
    width: u32,
    height: u32,
    fps: u32,
    readers: std::collections::HashMap<String, Reader>,
    /// Grades made ready, by their settings, and looks read, by file, so neither is redone every picture.
    ready: std::collections::HashMap<String, std::sync::Arc<crate::grade::Ready>>,
    looks: std::collections::HashMap<String, Option<crate::grade::Lut>>,
}

impl Drop for Making {
    fn drop(&mut self) {
        for r in self.readers.values_mut() {
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
    }
}

static MAKING: Mutex<Option<Making>> = Mutex::new(None);

/// How the finished file is made: an MP4 to share, or a ProRes master to keep editing with.
fn encoder_args(quality: u32, master: bool) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    if master {
        // ProRes 422 HQ, 10-bit: what editors hand to each other
        args.extend(["-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", "-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv422p10le,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709", "-movflags", "+write_colr"].map(String::from));
    } else {
        args.extend(h264(quality));
        args.extend(["-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709", "-movflags", "+faststart"].map(String::from));
    }
    args.extend(["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"].map(String::from));
    args
}

/// The ffmpeg arguments that turn 16-bit pictures handed in one by one, and the sound of the clips, into one file.
#[allow(clippy::too_many_arguments)]
fn scene_args(fps: u32, seconds: f64, quality: u32, sounds: &[Sound], out: &str, width: u32, height: u32, master: bool) -> Vec<String> {
    let mut args: Vec<String> = ["-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s"].map(String::from).to_vec();
    args.extend([format!("{width}x{height}"), "-framerate".into(), fps.to_string(), "-i".into(), "-".into()]);
    let mut graph = String::new();
    for (i, s) in sounds.iter().enumerate() {
        args.extend(["-ss".into(), format!("{:.3}", s.from.max(0.0)), "-t".into(), format!("{:.3}", s.length.max(0.05) * s.speed), "-i".into(), s.path.clone()]);
        let wait = (s.at.max(0.0) * 1000.0).round() as u64;
        let pace = if (s.speed - 1.0).abs() > 0.0001 { format!("{},", tempo(s.speed)) } else { String::new() };
        graph += &format!("[{}:a]aresample=48000,aformat=channel_layouts=stereo,{pace}volume={:.3},adelay={wait}:all=1[a{i}];", i + 1, s.volume.clamp(0.0, 1.0));
    }
    args.extend(["-map".into(), "0:v".into()]);
    if !sounds.is_empty() {
        for i in 0..sounds.len() {
            graph += &format!("[a{i}]");
        }
        // the sound runs exactly as long as the picture, with silence where no clip is heard
        graph += &format!("amix=inputs={}:normalize=0,apad,atrim=duration={seconds:.3}[a]", sounds.len());
        let audio: [&str; 2] = if master { ["-c:a", "pcm_s16le"] } else { ["-c:a", "aac"] };
        args.extend(["-filter_complex".into(), graph, "-map".into(), "[a]".into(), audio[0].into(), audio[1].into()]);
        if !master {
            args.extend(["-b:a".into(), "160k".into()]);
        }
    }
    // quality is ffmpeg's own scale: lower is finer and makes a bigger file
    args.extend(encoder_args(quality, master));
    args.push(out.into());
    args
}

/// Start making a video. Pictures follow with `scene_export_frame`, and `scene_export_end` finishes it.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn scene_export_begin(out: String, fps: u32, seconds: f64, quality: Option<u32>, sounds: Vec<Sound>, width: u32, height: u32, master: Option<bool>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
        // a clip with no sound in it has nothing to add
        let mut heard = Vec::new();
        for s in sounds {
            if has_sound(&s.path)? {
                heard.push(s);
            }
        }
        let fps = fps.clamp(1, 120);
        let encoder = crate::quiet_command(ffmpeg)
            .args(scene_args(fps, seconds, quality.unwrap_or(18), &heard, &out, width, height, master.unwrap_or(false)))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        let making = Making { encoder, width, height, fps, readers: Default::default(), ready: Default::default(), looks: Default::default() };
        if let Some(mut old) = MAKING.lock().map_err(|e| e.to_string())?.replace(making) {
            let _ = old.encoder.kill();
            let _ = old.encoder.wait();
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A clip drawn somewhere in the video, asked for at the size it is drawn.
#[derive(Deserialize)]
pub struct ClipAsk {
    id: String,
    path: String,
    /// The second in the file this picture shows.
    at: f64,
    #[serde(default = "one")]
    speed: f64,
    width: u32,
    height: u32,
    /// "bt601" for standard definition video, otherwise Rec.709.
    matrix: String,
}

/// How a file's picture is stored, asked once per file while Duet runs.
fn look_of(path: &str) -> crate::hdr::Look {
    static LOOKS: Mutex<Option<std::collections::HashMap<String, crate::hdr::Look>>> = Mutex::new(None);
    let mut looks = LOOKS.lock().unwrap_or_else(|e| e.into_inner());
    let map = looks.get_or_insert_with(Default::default);
    if let Some(look) = map.get(path) {
        return *look;
    }
    let look = describe(path).map(|t| crate::hdr::parse(&t)).unwrap_or_default();
    map.insert(path.to_string(), look);
    look
}

fn clip_reader_args(c: &ClipAsk, fps: u32, look: &crate::hdr::Look) -> Vec<String> {
    // an HDR clip is brought down to an ordinary picture, so it is not pale and grey
    let (matrix, hdr) = crate::hdr::reading(look, c.matrix == "bt601");
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-ss".into(),
        format!("{:.4}", c.at.max(0.0)),
        "-i".into(),
        c.path.clone(),
        "-an".into(),
        "-sn".into(),
        "-vf".into(),
        format!("setpts=PTS/{:.4},fps={fps},scale={}:{}:flags=lanczos+accurate_rnd+full_chroma_int:in_color_matrix={matrix}:in_range=auto:out_range=full{hdr}", c.speed.max(0.05), c.width, c.height),
        "-pix_fmt".into(),
        "rgba".into(),
        "-f".into(),
        "rawvideo".into(),
        "-".into(),
    ]
}

/// A clip under everything else in one picture of the video, filling it.
#[derive(Deserialize)]
struct Base {
    /// The element, so each clip keeps its own reader.
    id: String,
    path: String,
    /// The second in the file this picture shows.
    at: f64,
    /// How fast the file plays: the next picture is this many times a frame further on in the file.
    #[serde(default = "one")]
    speed: f64,
    /// The part of the clip's own picture that fills the video: x, y, width, height, in its pixels.
    crop: [u32; 4],
    /// "bt601" for standard definition video, otherwise Rec.709.
    matrix: String,
    grade: Option<crate::grade::Grade>,
}

#[derive(Deserialize)]
struct FrameInfo {
    base: Option<Base>,
    /// True when the body holds RGBA pixels of everything drawn over the clip, or of the whole picture when there is no clip.
    drawn: bool,
}

fn reader_args(b: &Base, width: u32, height: u32, fps: u32, look: &crate::hdr::Look) -> Vec<String> {
    let [x, y, w, h] = b.crop;
    // an HDR clip is brought down to an ordinary picture, so it is not pale and grey
    let (matrix, hdr) = crate::hdr::reading(look, b.matrix == "bt601");
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-ss".into(),
        format!("{:.4}", b.at.max(0.0)),
        "-i".into(),
        b.path.clone(),
        "-an".into(),
        "-sn".into(),
        "-vf".into(),
        format!("setpts=PTS/{:.4},fps={fps},crop={w}:{h}:{x}:{y},scale={width}:{height}:flags=lanczos+accurate_rnd+full_chroma_int:in_color_matrix={matrix}:in_range=auto:out_range=full{hdr}", b.speed.max(0.05)),
        "-pix_fmt".into(),
        "rgb48le".into(),
        "-f".into(),
        "rawvideo".into(),
        "-".into(),
    ]
}

impl Making {
    /// The clip's picture for this moment, read from its file, or black when the file has ended.
    fn base_picture(&mut self, b: &Base) -> Result<Vec<u16>, String> {
        use std::io::Read;
        let step = 1.0 / self.fps as f64;
        let n = (self.width * self.height * 3) as usize;
        let fresh = self.readers.get(&b.id).is_none_or(|r| (r.next - b.at).abs() > step / 2.0);
        if fresh {
            if let Some(mut old) = self.readers.remove(&b.id) {
                let _ = old.child.kill();
                let _ = old.child.wait();
            }
            let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
            let mut child = crate::quiet_command(ffmpeg)
                .args(reader_args(b, self.width, self.height, self.fps, &look_of(&b.path)))
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| e.to_string())?;
            let out = child.stdout.take().ok_or("The clip could not be read.")?;
            self.readers.insert(b.id.clone(), Reader { child, out, next: b.at, size: (self.width, self.height) });
        }
        let reader = self.readers.get_mut(&b.id).ok_or("The clip could not be read.")?;
        let mut bytes = vec![0u8; n * 2];
        let got = reader.out.read_exact(&mut bytes).is_ok();
        reader.next += step * b.speed;
        if !got {
            return Ok(vec![0; n]);
        }
        Ok(bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect())
    }

    /// A clip's picture for this moment, read from its file at the size asked, as RGBA. Empty when the file has ended.
    fn clip_picture(&mut self, c: &ClipAsk) -> Result<Vec<u8>, String> {
        use std::io::Read;
        let step = 1.0 / self.fps as f64;
        let key = format!("clip:{}", c.id);
        let fresh = self.readers.get(&key).is_none_or(|r| (r.next - c.at).abs() > step / 2.0 || r.size != (c.width, c.height));
        if fresh {
            if let Some(mut old) = self.readers.remove(&key) {
                let _ = old.child.kill();
                let _ = old.child.wait();
            }
            let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
            let mut child = crate::quiet_command(ffmpeg)
                .args(clip_reader_args(c, self.fps, &look_of(&c.path)))
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| e.to_string())?;
            let out = child.stdout.take().ok_or("The clip could not be read.")?;
            self.readers.insert(key.clone(), Reader { child, out, next: c.at, size: (c.width, c.height) });
        }
        let reader = self.readers.get_mut(&key).ok_or("The clip could not be read.")?;
        let mut bytes = vec![0u8; (c.width * c.height * 4) as usize];
        let got = reader.out.read_exact(&mut bytes).is_ok();
        reader.next += step * c.speed;
        Ok(if got { bytes } else { Vec::new() })
    }

    fn ready_for(&mut self, g: &crate::grade::Grade) -> std::sync::Arc<crate::grade::Ready> {
        let key = serde_json::to_string(g).unwrap_or_default();
        if let Some(r) = self.ready.get(&key) {
            return r.clone();
        }
        let look = if g.look.is_empty() || g.look_amount <= 0.0 {
            None
        } else {
            self.looks.entry(g.look.clone()).or_insert_with(|| std::fs::read_to_string(&g.look).ok().and_then(|t| crate::grade::Lut::parse(&t).ok())).clone()
        };
        if self.ready.len() > 64 {
            self.ready.clear();
        }
        let r = std::sync::Arc::new(crate::grade::Ready::new(g.clone(), look));
        self.ready.insert(key, r.clone());
        r
    }
}

/// Lay the drawn RGBA pixels, with their see-through parts, over 16-bit RGB pixels.
fn lay_over(under: &mut [u16], drawn: &[u8]) {
    for (px, d) in under.chunks_exact_mut(3).zip(drawn.chunks_exact(4)) {
        let a = d[3] as u32;
        if a == 0 {
            continue;
        }
        for i in 0..3 {
            let top = d[i] as u32 * 257;
            px[i] = ((top * a + px[i] as u32 * (255 - a)) / 255) as u16;
        }
    }
}

/// One clip's picture for this moment of the video being made, read from its own file at the size it
/// is drawn. Every clip is read here and not by the web view, which can hand back a black picture for a
/// large file without saying so.
#[tauri::command(async)]
pub fn scene_export_clip(ask: ClipAsk) -> Result<tauri::ipc::Response, String> {
    if ask.width == 0 || ask.height == 0 || ask.width > 16384 || ask.height > 16384 {
        return Err("That clip size cannot be read.".into());
    }
    let mut making = MAKING.lock().map_err(|e| e.to_string())?;
    let m = making.as_mut().ok_or("No video is being made.")?;
    Ok(tauri::ipc::Response::new(m.clip_picture(&ask)?))
}

/// One picture of the video. The header says what is in it; the body holds what was drawn, as RGBA.
/// A clip that fills the picture is read from its own file at full quality and graded here, in
/// 32-bit, and only what is drawn over it comes from the canvas.
#[tauri::command]
pub fn scene_export_frame(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("That was not a picture.".into());
    };
    let info: FrameInfo = request
        .headers()
        .get("x-duet-frame")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| serde_json::from_str(h).ok())
        .unwrap_or(FrameInfo { base: None, drawn: true });
    let mut making = MAKING.lock().map_err(|e| e.to_string())?;
    let m = making.as_mut().ok_or("No video is being made.")?;
    let n = (m.width * m.height) as usize;
    if info.drawn && bytes.len() != n * 4 {
        return Err("That picture is not the size of the video.".into());
    }
    let pixels = match &info.base {
        Some(b) => {
            let mut px = m.base_picture(b)?;
            if let Some(g) = &b.grade {
                let ready = m.ready_for(g);
                crate::grade::frame_rgb48(&ready, &mut px, m.width as usize);
            }
            if info.drawn {
                lay_over(&mut px, bytes);
            }
            px
        }
        None => bytes.chunks_exact(4).flat_map(|d| [d[0] as u16 * 257, d[1] as u16 * 257, d[2] as u16 * 257]).collect(),
    };
    let out: Vec<u8> = pixels.iter().flat_map(|v| v.to_le_bytes()).collect();
    let pipe = m.encoder.stdin.as_mut().ok_or("No video is being made.")?;
    pipe.write_all(&out).map_err(|_| "The video could not be made. ffmpeg stopped early.".to_string())
}

/// The last picture has been handed in: finish the file.
#[tauri::command]
pub async fn scene_export_end() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut making = MAKING.lock().map_err(|e| e.to_string())?.take().ok_or("No video is being made.")?;
        drop(making.encoder.stdin.take());
        let mut err = String::new();
        if let Some(mut e) = making.encoder.stderr.take() {
            use std::io::Read;
            let _ = e.read_to_string(&mut err);
        }
        let done = making.encoder.wait().map_err(|e| e.to_string())?;
        if done.success() {
            return Ok(());
        }
        let last: Vec<&str> = err.lines().rev().take(3).collect();
        Err(format!("The video could not be made. {}", last.into_iter().rev().collect::<Vec<_>>().join(" ")))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Give up on the video being made.
#[tauri::command]
pub fn scene_export_stop() {
    if let Ok(mut making) = MAKING.lock() {
        if let Some(mut m) = making.take() {
            let _ = m.encoder.kill();
            let _ = m.encoder.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_length_size_and_sound_from_ffmpeg_text() {
        let text = "  Duration: 00:16:10.20, start: 0.000000, bitrate: 6168 kb/s\n  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuvj420p(pc, bt709), 3684x1080, 5996 kb/s, 60 fps\n  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo";
        let info = parse_info(text).unwrap();
        assert!((info.duration - 970.2).abs() < 0.01);
        assert_eq!((info.width, info.height, info.sound), (3684, 1080, true));
        // an upright phone clip stored on its side
        let phone = "  Duration: 00:00:05.00, start: 0\n  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 30 fps\n      Side data:\n        displaymatrix: rotation of -90.00 degrees";
        let info = parse_info(phone).unwrap();
        assert_eq!((info.width, info.height, info.sound), (1080, 1920, false));
    }

    #[test]
    fn a_long_file_gets_fewer_frames_so_its_strip_stays_a_size_a_window_can_show() {
        assert_eq!(strip_step(30.0), 1.0);
        assert_eq!(strip_step(1000.0), 10.0);
    }

    #[test]
    fn loudness_is_the_loudest_moment_of_each_slice() {
        let slice = (PEAK_RATE as f64 * PEAK_SLICE) as usize;
        let mut samples: Vec<u8> = Vec::new();
        for i in 0..slice * 2 {
            let v: i16 = if i == slice + 3 { 32767 } else { 0 };
            samples.extend_from_slice(&v.to_le_bytes());
        }
        let peaks = peaks_of(&samples);
        assert_eq!(peaks.len(), 2);
        assert_eq!(peaks[0], 0);
        assert_eq!(peaks[1], 255);
    }

    fn clip(path: &str, start: f64, end: f64) -> Clip {
        Clip { path: path.into(), start, end }
    }

    #[test]
    fn joins_clips_in_order_and_gives_a_silent_one_sound() {
        let args = join_args(&[(clip("a.mp4", 1.0, 3.5), true), (clip("b.mov", 0.0, 2.0), false)], 1081, 1920, "out.mp4");
        let at = |s: &str| args.iter().position(|a| a == s).unwrap();
        assert!(at("a.mp4") < at("b.mov"));
        assert_eq!(args[at("a.mp4") - 2], "2.500");
        let graph = &args[at("-filter_complex") + 1];
        // an odd size is made even, which the video format needs
        assert!(graph.contains("scale=1080:1920"));
        assert!(graph.contains("[0:a]aresample"));
        assert!(graph.contains("anullsrc=r=48000:cl=stereo,atrim=duration=2.000[a1]"));
        assert!(graph.ends_with("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"));
        assert_eq!(args.last().unwrap(), "out.mp4");
    }

    #[test]
    fn a_frame_that_plays_gets_its_pictures_and_each_clip_heard_at_its_moment() {
        let sounds = vec![Sound { path: "a.mp4".into(), from: 1.0, at: 2.5, length: 3.0, volume: 0.5, speed: 1.0 }];
        let args = scene_args(30, 10.0, 18, &sounds, "out.mp4", 1920, 1080, false).join(" ");
        assert!(args.contains("-f rawvideo -pix_fmt rgb48le -s 1920x1080 -framerate 30 -i -"));
        assert!(args.contains("format=yuv420p") && args.contains("-color_primaries bt709"));
        assert!(args.contains("-ss 1.000 -t 3.000 -i a.mp4"));
        assert!(args.contains("volume=0.500,adelay=2500:all=1[a0]"));
        assert!(args.contains("atrim=duration=10.000[a]"));
        let silent = scene_args(30, 10.0, 18, &[], "out.mp4", 1920, 1080, false).join(" ");
        assert!(!silent.contains("filter_complex"));
        let master = scene_args(30, 10.0, 18, &sounds, "out.mov", 1920, 1080, true).join(" ");
        assert!(master.contains("prores_ks -profile:v 3") && master.contains("yuv422p10le") && master.contains("pcm_s16le"));
    }

    #[test]
    fn a_faster_or_slower_clip_uses_more_or_less_of_its_file_and_its_sound_keeps_pace() {
        let fast = vec![Sound { path: "a.mp4".into(), from: 1.0, at: 0.0, length: 3.0, volume: 1.0, speed: 2.0 }];
        let args = scene_args(30, 10.0, 18, &fast, "out.mp4", 1920, 1080, false).join(" ");
        assert!(args.contains("-ss 1.000 -t 6.000 -i a.mp4"));
        assert!(args.contains("atempo=2.0000,volume=1.000"));
        let slow = vec![Sound { path: "a.mp4".into(), from: 0.0, at: 0.0, length: 4.0, volume: 1.0, speed: 0.25 }];
        let args = scene_args(30, 10.0, 18, &slow, "out.mp4", 1920, 1080, false).join(" ");
        assert!(args.contains("-t 1.000 -i a.mp4"));
        assert!(args.contains("atempo=0.5,atempo=0.5000,volume"));
        assert_eq!(tempo(1.5), "atempo=1.5000");
    }

    #[test]
    fn a_clip_playing_at_double_speed_is_read_a_picture_every_two_frames_of_its_file() {
        let b = Base { id: "v".into(), path: "a.mov".into(), at: 0.0, speed: 2.0, crop: [0, 0, 1920, 1080], matrix: "bt709".into(), grade: None };
        assert!(reader_args(&b, 1920, 1080, 24, &Default::default()).join(" ").contains("setpts=PTS/2.0000,fps=24"));
    }

    #[test]
    fn a_clip_is_read_at_its_moment_cut_to_the_part_that_fills_the_video() {
        let b = Base { id: "v".into(), path: "a.mov".into(), at: 2.5, speed: 1.0, crop: [10, 20, 1900, 1060], matrix: "bt709".into(), grade: None };
        let args = reader_args(&b, 1920, 1080, 24, &Default::default()).join(" ");
        assert!(args.contains("-ss 2.5000 -i a.mov"));
        assert!(args.contains("fps=24,crop=1900:1060:10:20,scale=1920:1080"));
        assert!(args.contains("in_color_matrix=bt709") && args.ends_with("-pix_fmt rgb48le -f rawvideo -"));
    }

    #[test]
    fn drawn_pixels_lie_over_the_clip_by_how_see_through_they_are() {
        let mut under = vec![0u16, 0, 0, 65535, 65535, 65535];
        lay_over(&mut under, &[255, 0, 0, 255, 0, 0, 0, 0]);
        assert_eq!(under, vec![65535, 0, 0, 65535, 65535, 65535]);
    }

    #[test]
    fn light_copies_not_played_for_two_weeks_are_thrown_away() {
        let dir = std::env::temp_dir().join(format!("duet-previews-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["old.mp4", "new.mp4", "half.part.mp4"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        let day = std::time::Duration::from_secs(24 * 60 * 60);
        let now = std::time::SystemTime::now() + day * 15;
        std::fs::File::options().append(true).open(dir.join("new.mp4")).unwrap().set_modified(now - day).unwrap();
        forget_old_previews(&dir, now);
        assert!(!dir.join("old.mp4").exists());
        assert!(dir.join("new.mp4").exists());
        assert!(!dir.join("half.part.mp4").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[derive(Serialize)]
pub struct Strip {
    /// The picture made of small frames side by side, left to right.
    path: String,
    /// Seconds of the file between one frame and the next.
    step: f64,
    count: u32,
    /// One frame's size in the picture.
    width: u32,
    height: u32,
}

const STRIP_HEIGHT: u32 = 48;
const STRIP_MOST: f64 = 100.0;

/// How a long file is sampled for its strip of frames: one a second, or fewer so the picture stays a size a window can show.
fn strip_step(duration: f64) -> f64 {
    (duration / STRIP_MOST).max(1.0)
}

/// A strip of small frames from a clip, for its bar on the timeline. Made once per file and kept in
/// Duet's own folder with the light copies. Returns where the picture is and how it is laid out.
#[tauri::command(async)]
pub fn clip_strip(path: String) -> Result<Strip, String> {
    use std::hash::{Hash, Hasher};
    let info = probe(&path)?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    meta.len().hash(&mut h);
    meta.modified().ok().hash(&mut h);
    let name = format!("{:016x}-strip", h.finish());
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map_err(|e| e.to_string())?;
    let dir = PathBuf::from(home).join(crate::duet_dir_name()).join("previews");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let step = strip_step(info.duration);
    let count = ((info.duration / step).ceil() as u32).max(1);
    let width = ((STRIP_HEIGHT as f64 * info.width as f64 / info.height.max(1) as f64).round() as u32).max(2) & !1;
    let strip = Strip { path: String::new(), step, count, width, height: STRIP_HEIGHT };
    let out = dir.join(format!("{name}.jpg"));
    if out.is_file() {
        if let Ok(f) = std::fs::File::options().append(true).open(&out) {
            let _ = f.set_modified(std::time::SystemTime::now());
        }
        return Ok(Strip { path: out.to_string_lossy().to_string(), ..strip });
    }
    let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
    let part = dir.join(format!("{name}.part.jpg"));
    let filter = format!("fps=1/{step},scale={width}:{STRIP_HEIGHT},tile={count}x1");
    let status = crate::quiet_command(&ffmpeg)
        .args(["-y", "-v", "error", "-i", &path, "-an", "-vf", &filter, "-frames:v", "1", "-q:v", "6"])
        .arg(&part)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() || !part.is_file() {
        let _ = std::fs::remove_file(&part);
        return Err("Frames of this clip could not be made.".into());
    }
    std::fs::rename(&part, &out).map_err(|e| e.to_string())?;
    Ok(Strip { path: out.to_string_lossy().to_string(), ..strip })
}

/// How loud a file is along its length, for drawing its sound: the loudest moment in each slice of
/// `PEAK_SLICE` seconds, 0 to 255. Empty when the file has no sound.
const PEAK_SLICE: f64 = 0.05;
const PEAK_RATE: u32 = 2000;

fn peaks_of(samples: &[u8]) -> Vec<u8> {
    let per = (PEAK_RATE as f64 * PEAK_SLICE) as usize;
    samples
        .chunks(per * 2)
        .map(|c| {
            let loudest = c.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]).unsigned_abs()).max().unwrap_or(0);
            // a gentle curve, so quiet speech still shows
            ((loudest as f64 / 32768.0).sqrt() * 255.0).round().min(255.0) as u8
        })
        .collect()
}

#[tauri::command(async)]
pub fn clip_peaks(path: String) -> Result<Vec<u8>, String> {
    if !has_sound(&path)? {
        return Ok(Vec::new());
    }
    let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
    let out = crate::quiet_command(&ffmpeg)
        .args(["-v", "error", "-i", &path, "-vn", "-ac", "1", "-ar", &PEAK_RATE.to_string(), "-f", "s16le", "-"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    Ok(peaks_of(&out.stdout))
}

/// Light copies not played for this long are thrown away. A clip played again later gets a new one.
const PREVIEW_KEPT: std::time::Duration = std::time::Duration::from_secs(14 * 24 * 60 * 60);

/// Throw away light copies nobody has played for a while, and copies left half made.
fn forget_old_previews(dir: &std::path::Path, now: std::time::SystemTime) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let Ok(used) = entry.metadata().and_then(|m| m.modified()) else { continue };
        let half_made = entry.file_name().to_string_lossy().ends_with(".part.mp4");
        let kept = if half_made { std::time::Duration::from_secs(24 * 60 * 60) } else { PREVIEW_KEPT };
        if now.duration_since(used).map_or(false, |age| age > kept) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// A light copy of a clip for playing and scrubbing on the canvas: smaller, with a picture to land on
/// every few frames. Kept in Duet's own folder and made once per file. Making a video still uses the
/// original. Returns where the copy is.
#[tauri::command(async)]
pub fn clip_preview(path: String) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    meta.len().hash(&mut h);
    meta.modified().ok().hash(&mut h);
    let name = format!("{:016x}", h.finish());
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map_err(|e| e.to_string())?;
    let dir = PathBuf::from(home).join(crate::duet_dir_name()).join("previews");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(format!("{name}.mp4"));
    forget_old_previews(&dir, std::time::SystemTime::now());
    if out.is_file() {
        // marked as used, so it is kept while the clip is still played
        if let Ok(f) = std::fs::File::options().append(true).open(&out) {
            let _ = f.set_modified(std::time::SystemTime::now());
        }
        return Ok(out.to_string_lossy().to_string());
    }
    let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
    let part = dir.join(format!("{name}.part.mp4"));
    // the computer's own video chip, so the copy is made quickly and quietly
    let encoder: &[&str] = if cfg!(target_os = "macos") {
        &["-c:v", "h264_videotoolbox", "-b:v", "4M"]
    } else if cfg!(windows) {
        &["-c:v", "h264_mf", "-b:v", "4M"]
    } else {
        &["-c:v", "libx264", "-preset", "veryfast", "-crf", "26"]
    };
    let status = crate::quiet_command(&ffmpeg)
        .args(["-y", "-v", "error", "-i", &path, "-vf", "scale=w=min(1280\\,iw):h=min(1280\\,ih):force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-g", "12", "-pix_fmt", "yuv420p"])
        .args(encoder)
        .args(["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"])
        .arg(&part)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        let _ = std::fs::remove_file(&part);
        return Err("A light copy of this clip could not be made. The original plays instead.".into());
    }
    std::fs::rename(&part, &out).map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().to_string())
}
