//! Connect to ChatGPT and Claude: lets an AI on the web work in this Duet.
//!
//! 1. A second small server on this computer only, answering at a secret path. It passes each
//!    request on to Duet's own AI connection with Duet's own password.
//! 2. Cloudflare's free tunnel gives that server a public https address. Duet uses a copy already
//!    on the computer, or fetches Cloudflare's own release once and checks it against the
//!    checksum Cloudflare publishes with it.
//! 3. A web AI has no files here, so pictures it gives as links are fetched and passed on as files.
//!
//! Turning it off stops the tunnel, and the address stops working at once.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const RELEASES: &str = "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";
const MAX_PICTURE: u64 = 30 * 1024 * 1024;

#[derive(Default)]
pub struct ConnectState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// "off", "starting", "on" or "error"
    status: String,
    /// What is happening now, or what went wrong, in plain words.
    note: String,
    link: Option<String>,
    tunnel: Option<Child>,
    /// Bumped on every start and stop, so an old tunnel never reports into a newer one.
    run: u64,
    /// The last few pictures look_at_design took, for the card in the chat to show.
    pictures: Vec<(u64, String, Vec<u8>)>,
    next_picture: u64,
}

fn report(app: &AppHandle) {
    let _ = app.emit("connect-status", status_of(app));
}

fn status_of(app: &AppHandle) -> Value {
    let s = app.state::<Arc<ConnectState>>();
    let i = s.inner.lock().unwrap();
    json!({
        "status": if i.status.is_empty() { "off" } else { i.status.as_str() },
        "note": i.note,
        "link": i.link,
    })
}

fn set(app: &AppHandle, run: u64, status: &str, note: &str) {
    {
        let s = app.state::<Arc<ConnectState>>();
        let mut i = s.inner.lock().unwrap();
        if i.run != run {
            return;
        }
        i.status = status.into();
        i.note = note.into();
    }
    report(app);
}

#[tauri::command]
pub fn connect_status(app: AppHandle) -> Value {
    status_of(&app)
}

#[tauri::command]
pub fn connect_start(app: AppHandle) {
    let run = {
        let s = app.state::<Arc<ConnectState>>();
        let mut i = s.inner.lock().unwrap();
        if i.status == "on" || i.status == "starting" {
            return;
        }
        i.run += 1;
        i.status = "starting".into();
        i.note = "Getting ready".into();
        i.link = None;
        i.run
    };
    report(&app);
    std::thread::spawn(move || {
        if let Err(e) = start(&app, run) {
            stop_tunnel(&app);
            set(&app, run, "error", &e);
        }
    });
}

#[tauri::command]
pub fn connect_stop(app: AppHandle) {
    stop_tunnel(&app);
    {
        let s = app.state::<Arc<ConnectState>>();
        let mut i = s.inner.lock().unwrap();
        i.run += 1;
        i.status = "off".into();
        i.note.clear();
        i.link = None;
    }
    report(&app);
}

/// A tunnel left running by a Duet that did not quit cleanly is stopped when Duet starts again.
/// Only a process that is still the tunnel program is stopped, never one that took over its number.
pub fn sweep(app: &AppHandle) {
    let Ok(file) = own_dir(app).map(|d| d.join("tunnel.pid")) else { return };
    let Some(pid) = std::fs::read_to_string(&file).ok().and_then(|p| p.trim().parse::<u32>().ok()) else { return };
    let _ = std::fs::remove_file(&file);
    #[cfg(unix)]
    {
        let name = crate::quiet_command("ps").args(["-p", &pid.to_string(), "-o", "comm="]).output();
        if name.is_ok_and(|o| String::from_utf8_lossy(&o.stdout).contains("cloudflared")) {
            let _ = crate::quiet_command("kill").arg(pid.to_string()).status();
        }
    }
    #[cfg(windows)]
    {
        let list = crate::quiet_command("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH"]).output();
        if list.is_ok_and(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("cloudflared")) {
            let _ = crate::quiet_command("taskkill").args(["/PID", &pid.to_string(), "/F"]).status();
        }
    }
}

/// Stop the tunnel. Called when Duet quits, too.
pub fn stop_tunnel(app: &AppHandle) {
    let Some(s) = app.try_state::<Arc<ConnectState>>() else { return };
    let child = s.inner.lock().unwrap().tunnel.take();
    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
        if let Ok(dir) = own_dir(app) {
            let _ = std::fs::remove_file(dir.join("tunnel.pid"));
        }
    }
}

fn start(app: &AppHandle, run: u64) -> Result<(), String> {
    let program = tunnel_program(app, run)?;
    let secret = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let port = serve(app.clone(), secret.clone())?;
    set(app, run, "starting", "Opening the connection");

    let mut child = crate::quiet_command(&program)
        .args(["tunnel", "--no-autoupdate", "--url", &format!("http://127.0.0.1:{port}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("The connection could not start: {e}"))?;
    if let Ok(dir) = own_dir(app) {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("tunnel.pid"), child.id().to_string());
    }
    let stderr = child.stderr.take().ok_or("The connection could not start.")?;
    {
        let s = app.state::<Arc<ConnectState>>();
        let mut i = s.inner.lock().unwrap();
        if i.run != run {
            let _ = child.kill();
            return Ok(());
        }
        i.tunnel = Some(child);
    }
    // The public address arrives on the tunnel's log. Keep reading after it, so the tunnel never blocks.
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut found = false;
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if found {
                continue;
            }
            if let Some(host) = trycloudflare(&line) {
                found = true;
                let s = app2.state::<Arc<ConnectState>>();
                {
                    let mut i = s.inner.lock().unwrap();
                    if i.run != run {
                        return;
                    }
                    i.link = Some(format!("{host}/{secret}/mcp"));
                    i.status = "on".into();
                    i.note.clear();
                }
                report(&app2);
            }
        }
        // the tunnel ended by itself
        let s = app2.state::<Arc<ConnectState>>();
        let ended = {
            let mut i = s.inner.lock().unwrap();
            let mine = i.run == run && i.status != "off";
            if mine {
                i.tunnel = None;
                i.link = None;
            }
            mine
        };
        if ended {
            set(&app2, run, "error", "The connection closed. Turn it on again for a new link.");
        }
    });
    Ok(())
}

fn trycloudflare(line: &str) -> Option<String> {
    let at = line.find("https://")?;
    let rest = &line[at..];
    let end = rest.find(|c: char| c.is_whitespace() || c == '|').unwrap_or(rest.len());
    let url = &rest[..end];
    url.ends_with(".trycloudflare.com").then(|| url.to_string())
}

// ---------- the tunnel program ----------

fn own_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let _ = app;
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map_err(|_| "No home folder found.")?;
    Ok(PathBuf::from(home).join(crate::duet_dir_name()).join("addons").join("connect"))
}

fn exe_name() -> &'static str {
    if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    }
}

/// The release file for this computer, as Cloudflare names it.
fn release_name() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("cloudflared-darwin-arm64.tgz"),
        ("macos", "x86_64") => Ok("cloudflared-darwin-amd64.tgz"),
        ("windows", "x86_64") => Ok("cloudflared-windows-amd64.exe"),
        ("windows", "x86") => Ok("cloudflared-windows-386.exe"),
        ("linux", "x86_64") => Ok("cloudflared-linux-amd64"),
        ("linux", "aarch64") => Ok("cloudflared-linux-arm64"),
        _ => Err("This computer is not one the connection supports yet.".into()),
    }
}

fn tunnel_program(app: &AppHandle, run: u64) -> Result<PathBuf, String> {
    let own = own_dir(app)?.join(exe_name());
    if own.exists() {
        return Ok(own);
    }
    // one already installed, where installers put it
    let known: &[&str] = if cfg!(windows) {
        &["C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe"]
    } else {
        &["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared", "/usr/bin/cloudflared"]
    };
    if let Some(p) = known.iter().map(PathBuf::from).find(|p| p.exists()) {
        return Ok(p);
    }
    set(app, run, "starting", "Setting up, once only");
    fetch_tunnel_program(&own)?;
    Ok(own)
}

fn curl() -> std::process::Command {
    let mut c = crate::quiet_command(if cfg!(windows) { "curl.exe" } else { "/usr/bin/curl" });
    c.args(["-fsSL", "--proto", "=https", "--max-time", "300", "-A", "Duet"]);
    c
}

fn fetch_tunnel_program(dest: &PathBuf) -> Result<(), String> {
    let name = release_name()?;
    let out = curl().arg(RELEASES).output().map_err(|e| format!("Could not reach Cloudflare: {e}"))?;
    if !out.status.success() {
        return Err("Could not reach Cloudflare. Check the internet connection.".into());
    }
    let release: Value = serde_json::from_slice(&out.stdout).map_err(|_| "Cloudflare's answer could not be read.")?;
    let url = release["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["name"] == name))
        .and_then(|x| x["browser_download_url"].as_str())
        .ok_or("Cloudflare has no copy for this computer.")?
        .to_string();
    if !url.starts_with("https://github.com/cloudflare/cloudflared/releases/download/") {
        return Err("The copy was not where Cloudflare keeps it, so it was not used.".into());
    }
    // Cloudflare lists each file's checksum in the release notes: "name: hash"
    let body = release["body"].as_str().unwrap_or("");
    let expected = body
        .lines()
        .find_map(|l| l.trim().strip_prefix(&format!("{name}: ")).map(|h| h.trim().to_lowercase()))
        .ok_or("Cloudflare did not list a checksum, so the copy was not used.")?;

    let dir = dest.parent().ok_or("No folder.")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let download = dir.join(format!("{name}.part"));
    let got = curl().arg("-o").arg(&download).arg(&url).status().map_err(|e| e.to_string())?;
    if !got.success() {
        let _ = std::fs::remove_file(&download);
        return Err("The download did not finish. Try again.".into());
    }
    // For the Mac copies Cloudflare lists the checksum of the program inside the archive; for Windows, of the file itself.
    let unpacked = dir.join(format!("{}.new", exe_name()));
    if name.ends_with(".tgz") {
        let ok = crate::quiet_command("tar").arg("-xzf").arg(&download).arg("-C").arg(dir).arg("cloudflared").status().map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&download);
        if !ok.success() {
            return Err("The download could not be unpacked.".into());
        }
        std::fs::rename(dir.join("cloudflared"), &unpacked).map_err(|e| e.to_string())?;
    } else {
        std::fs::rename(&download, &unpacked).map_err(|e| e.to_string())?;
    }
    let bytes = std::fs::read(&unpacked).map_err(|e| e.to_string())?;
    if sha256_hex(&bytes) != expected {
        let _ = std::fs::remove_file(&unpacked);
        return Err("The download did not match Cloudflare's checksum, so it was not used.".into());
    }
    std::fs::rename(&unpacked, dest).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

// A small SHA-256, so checking one download needs no extra library.
fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for t in 0..16 {
            w[t] = u32::from_be_bytes([chunk[4 * t], chunk[4 * t + 1], chunk[4 * t + 2], chunk[4 * t + 3]]);
        }
        for t in 16..64 {
            let s0 = w[t - 15].rotate_right(7) ^ w[t - 15].rotate_right(18) ^ (w[t - 15] >> 3);
            let s1 = w[t - 2].rotate_right(17) ^ w[t - 2].rotate_right(19) ^ (w[t - 2] >> 10);
            w[t] = w[t - 16].wrapping_add(s0).wrapping_add(w[t - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for t in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[t]).wrapping_add(w[t]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *x = x.wrapping_add(y);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

// ---------- the gatekeeper ----------

/// Start the server the tunnel points at. Returns its port. It ends with Duet.
fn serve(app: AppHandle, secret: String) -> Result<u16, String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().map(|a| a.port()).ok_or("no port")?;
    let route = format!("/{secret}/mcp");
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            // a newer start made a new server; this one stops answering
            let live = app.state::<Arc<ConnectState>>().inner.lock().unwrap().link.as_deref().is_none_or(|l| l.ends_with(&route));
            if !live {
                let _ = req.respond(tiny_http::Response::from_string("{}").with_status_code(404));
                break;
            }
            let app = app.clone();
            let route = route.clone();
            std::thread::spawn(move || handle(req, &app, &route));
        }
    });
    Ok(port)
}

fn reply(req: tiny_http::Request, code: u16, body: String) {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    let _ = req.respond(tiny_http::Response::from_string(body).with_status_code(code).with_header(header));
}

fn handle(mut req: tiny_http::Request, app: &AppHandle, route: &str) {
    let path = req.url().split('?').next().unwrap_or("").to_string();
    let base = route.trim_end_matches("/mcp");
    if let Some(name) = path.strip_prefix(&format!("{base}/picture/")).map(|n| n.trim_end_matches(".png").to_string()) {
        let s = app.state::<Arc<ConnectState>>();
        let i = s.inner.lock().unwrap();
        // "latest" is the card's own way in, when the chat did not hand it the picture
        let found = if name == "latest" { i.pictures.last() } else { name.parse::<u64>().ok().and_then(|n| i.pictures.iter().find(|p| p.0 == n)) }
            .map(|p| (p.1.clone(), p.2.clone()));
        drop(i);
        return match found {
            Some((mime, bytes)) => {
                let kind = tiny_http::Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()).unwrap();
                let open = tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
                let _ = req.respond(tiny_http::Response::from_data(bytes).with_header(kind).with_header(open));
            }
            None => reply(req, 404, "{}".into()),
        };
    }
    if path != route {
        return reply(req, 404, "{}".into());
    }
    if req.method() != &tiny_http::Method::Post {
        return reply(req, 405, "{\"error\":\"use POST\"}".into());
    }
    let mut body = String::new();
    if req.as_reader().take(20 * 1024 * 1024).read_to_string(&mut body).is_err() {
        return reply(req, 400, "{}".into());
    }
    let Ok(mut msg) = serde_json::from_str::<Value>(&body) else {
        return reply(req, 400, "{}".into());
    };
    if msg["method"] == "tools/call" && msg["params"]["name"] == "place_image" {
        if let Err(e) = bring_picture(app, &mut msg["params"]["arguments"]) {
            let text = json!({"jsonrpc": "2.0", "id": msg["id"], "result": {"content": [{"type": "text", "text": format!("The picture could not be fetched: {e}")}], "isError": true}});
            return reply(req, 200, text.to_string());
        }
    }
    let mut sent = msg.clone();
    if msg["method"] == "tools/call" && msg["params"]["name"] == SHOW {
        sent["params"]["name"] = json!("look_at_design");
        let id = msg["params"]["arguments"]["id"].clone();
        sent["params"]["arguments"] = if id.is_string() { json!({"ids": [id]}) } else { json!({}) };
    }
    if let Some(text) = own_answer(app, &msg) {
        return reply(req, 200, text);
    }
    let Some((code, mut answer)) = to_duet(app, &sent) else {
        return reply(req, 503, "{\"error\":\"Duet is not ready\"}".into());
    };
    if code == 202 {
        let _ = req.respond(tiny_http::Response::empty(202));
        return;
    }
    if code == 200 {
        if let Ok(mut d) = serde_json::from_str::<Value>(&answer) {
            dress(app, &msg, &mut d);
            answer = d.to_string();
        }
    }
    reply(req, code, answer);
}

// ---------- the preview card ----------
// ChatGPT and Claude can show a small page beside a tool's answer. Duet's is the picture
// look_at_design takes, so the designer sees the work in the chat too.

const CARD_OPENAI: &str = "ui://duet/preview-openai.html";
const CARD: &str = "ui://duet/preview.html";
const CARD_HTML: &str = include_str!("connect_card.html");
/// A tool only web AIs get: look_at_design, shown to the designer as a card.
const SHOW: &str = "show_design";

/// Requests the connection answers itself: the card's page.
fn own_answer(app: &AppHandle, msg: &Value) -> Option<String> {
    let result = match msg["method"].as_str()? {
        "resources/list" => json!({"resources": [
            {"uri": CARD_OPENAI, "name": "Duet preview", "mimeType": "text/html+skybridge"},
            {"uri": CARD, "name": "Duet preview", "mimeType": "text/html;profile=mcp-app"}
        ]}),
        "resources/templates/list" => json!({"resourceTemplates": []}),
        "resources/read" => {
            let uri = msg["params"]["uri"].as_str()?;
            let mime = match uri {
                CARD_OPENAI => "text/html+skybridge",
                CARD => "text/html;profile=mcp-app",
                _ => return None,
            };
            // the card loads its picture from this connection's own address
            let host = public_host(app).unwrap_or_default();
            let meta = json!({
                "openai/widgetCSP": {"connect_domains": [], "resource_domains": [host]},
                "openai/widgetDescription": "A picture of the design in Duet, as it is now.",
                "ui": {"csp": {"resourceDomains": [host]}, "prefersBorder": false}
            });
            let base = s_link(app).map(|l| l.trim_end_matches("/mcp").to_string()).unwrap_or_default();
            let html = CARD_HTML.replace("__DUET_BASE__", &base);
            json!({"contents": [{"uri": uri, "mimeType": mime, "text": html, "_meta": meta}]})
        }
        _ => return None,
    };
    Some(json!({"jsonrpc": "2.0", "id": msg["id"], "result": result}).to_string())
}

/// What a web AI needs on top of Duet's own answers.
fn s_link(app: &AppHandle) -> Option<String> {
    app.state::<Arc<ConnectState>>().inner.lock().unwrap().link.clone()
}

fn public_host(app: &AppHandle) -> Option<String> {
    let s = app.state::<Arc<ConnectState>>();
    let link = s.inner.lock().unwrap().link.clone()?;
    Some(link.splitn(4, '/').take(3).collect::<Vec<_>>().join("/"))
}

/// Keep a picture for the card, and give the address it is served at.
fn keep_picture(app: &AppHandle, mime: &str, data: &str) -> Option<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).ok()?;
    let s = app.state::<Arc<ConnectState>>();
    let mut i = s.inner.lock().unwrap();
    let link = i.link.clone()?;
    i.next_picture += 1;
    let n = i.next_picture;
    i.pictures.push((n, mime.to_string(), bytes));
    if i.pictures.len() > 8 {
        i.pictures.remove(0);
    }
    Some(format!("{}/picture/{n}.png", link.trim_end_matches("/mcp")))
}

fn dress(app: &AppHandle, msg: &Value, d: &mut Value) {
    match msg["method"].as_str() {
        Some("initialize") => {
            d["result"]["capabilities"]["resources"] = json!({});
        }
        Some("tools/list") => {
            if let Some(tools) = d["result"]["tools"].as_array_mut() {
                for t in tools.iter_mut() {
                    if t["name"] == "place_image" {
                        teach_place_image(t);
                    }
                }
                tools.push(json!({
                    "name": SHOW,
                    "description": "Show the designer one frame in this chat, as a picture: the frame you just worked on. Call it once when you finish a piece of work, and whenever the designer asks to see it.",
                    "inputSchema": {"type": "object", "properties": {"id": {"type": "string", "description": "The id of the one frame to show."}}, "required": ["id"]},
                    "annotations": {"readOnlyHint": true},
                    "_meta": {
                        "openai/outputTemplate": CARD_OPENAI,
                        "openai/toolInvocation/invoking": "Showing the design",
                        "openai/toolInvocation/invoked": "Here is the design",
                        "ui": {"resourceUri": CARD}
                    }
                }));
            }
        }
        Some("tools/call") if msg["params"]["name"] == "look_at_design" || msg["params"]["name"] == SHOW => {
            let content = d["result"]["content"].as_array().cloned().unwrap_or_default();
            let picture = content
                .iter()
                .find(|c| c["type"] == "image")
                .and_then(|c| keep_picture(app, c["mimeType"].as_str().unwrap_or("image/png"), c["data"].as_str()?));
            let caption = content.iter().find(|c| c["type"] == "text").and_then(|c| c["text"].as_str()).unwrap_or("");
            if let Some(picture) = picture {
                d["result"]["structuredContent"] = json!({"picture": picture, "caption": caption});
            }
        }
        _ => {}
    }
}

/// Pass one request to Duet's own AI connection, as any AI tool on this computer would.
fn to_duet(app: &AppHandle, msg: &Value) -> Option<(u16, String)> {
    let (port, token) = crate::ai::local_address(app)?;
    let line = msg.to_string();
    let mut conn = TcpStream::connect(("127.0.0.1", port)).ok()?;
    let _ = conn.set_read_timeout(Some(Duration::from_secs(340)));
    let head = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nX-Duet-Client: web-ai\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        line.len()
    );
    conn.write_all(head.as_bytes()).ok()?;
    conn.write_all(line.as_bytes()).ok()?;
    let mut raw = Vec::new();
    let _ = conn.read_to_end(&mut raw);
    let text = String::from_utf8_lossy(&raw);
    let code = text.split_whitespace().nth(1)?.parse().ok()?;
    Some((code, crate::ai::http_body(&raw)))
}

/// place_image also takes a web link, or a picture from the conversation, which ChatGPT hands over as {download_url}.
fn teach_place_image(tool: &mut Value) {
    let props = &mut tool["inputSchema"]["properties"];
    props["url"] = json!({"type": "string", "description": "A web link (https) to a picture. Use instead of path."});
    props["image"] = json!({
        "type": "object",
        "description": "A picture from this conversation, such as one you made or one the designer attached. Use instead of path.",
        "properties": {"download_url": {"type": "string"}, "file_id": {"type": "string"}},
        "required": ["download_url", "file_id"],
        "additionalProperties": false
    });
    tool["inputSchema"]["required"] = json!(["x", "y"]);
    let said = tool["description"].as_str().unwrap_or("").to_string();
    tool["description"] = json!(format!(
        "{said} A web AI has no files on this computer: a picture you made or were given in this conversation goes in image, and a web link goes in url. When you make a picture for the design, place it right away in the same turn."
    ));
    tool["_meta"]["openai/fileParams"] = json!(["image"]);
}

fn bring_picture(app: &AppHandle, args: &mut Value) -> Result<(), String> {
    let link = args["image"]["download_url"].as_str().or(args["url"].as_str()).map(str::to_string);
    if let Some(obj) = args.as_object_mut() {
        obj.remove("image");
        obj.remove("url");
    }
    let Some(link) = link else { return Ok(()) };
    if args["path"].as_str().is_some_and(|p| !p.is_empty()) {
        return Ok(());
    }
    if !link.starts_with("https://") {
        return Err("only https links can be brought in.".into());
    }
    let dir = own_dir(app)?.join("pictures");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let part = dir.join(format!("{stamp}.part"));
    let out = curl()
        .args(["--max-filesize", &MAX_PICTURE.to_string(), "-w", "%{content_type}", "-o"])
        .arg(&part)
        .arg(&link)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let _ = std::fs::remove_file(&part);
        return Err("the link did not answer with a picture under 30 MB.".into());
    }
    let kind = String::from_utf8_lossy(&out.stdout).split(';').next().unwrap_or("").trim().to_lowercase();
    let ext = match kind.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => {
            let _ = std::fs::remove_file(&part);
            return Err("that link is not a PNG, JPG, GIF, WebP or SVG picture.".into());
        }
    };
    let file = dir.join(format!("{stamp}.{ext}"));
    std::fs::rename(&part, &file).map_err(|e| e.to_string())?;
    args["path"] = json!(file.to_string_lossy());
    if args["name"].as_str().is_none_or(|n| n.trim().is_empty()) {
        args["name"] = json!("Picture");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_downloads_with_sha256() {
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let long = vec![b'a'; 1000];
        assert_eq!(sha256_hex(&long), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
    }

    #[test]
    fn finds_the_public_address_in_the_tunnel_log() {
        let line = "2026-10-28T13:41:57Z INF |  https://desert-undo-dedicated-steve.trycloudflare.com                                  |";
        assert_eq!(trycloudflare(line).as_deref(), Some("https://desert-undo-dedicated-steve.trycloudflare.com"));
        assert_eq!(trycloudflare("see https://www.cloudflare.com/website-terms/"), None);
    }

    #[test]
    fn teaches_place_image_to_take_links() {
        let mut t = json!({"name": "place_image", "description": "Put a picture.", "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path", "x", "y"]}});
        teach_place_image(&mut t);
        assert_eq!(t["inputSchema"]["required"], json!(["x", "y"]));
        assert_eq!(t["_meta"]["openai/fileParams"], json!(["image"]));
        assert!(t["inputSchema"]["properties"]["image"]["properties"]["download_url"].is_object());
    }
}

#[cfg(test)]
mod online {
    /// Reaches the internet, so it runs only when asked: cargo test -- --ignored fetches
    #[test]
    #[ignore]
    fn fetches_and_checks_the_tunnel_program() {
        let dir = std::env::temp_dir().join(format!("duet-connect-{}", std::process::id()));
        let dest = dir.join(super::exe_name());
        super::fetch_tunnel_program(&dest).unwrap();
        let out = std::process::Command::new(&dest).arg("--version").output().unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).contains("cloudflared version"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
