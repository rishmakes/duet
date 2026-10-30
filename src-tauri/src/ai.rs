//! The bridge between Duet and AI agents.
//!
//! 1. A small web server on this computer only (127.0.0.1) speaks MCP, so any agent can read
//!    and change the design with the same commands the interface uses. A secret token guards it.
//! 2. A runner starts the agent tool the user already has (for now Claude Code), streams what it
//!    says back to the chat, and can stop it.
//!
//! The design itself lives in the interface. Requests from agents are handed to it and the
//! answer is sent back, so the interface stays the single owner of the document.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// How long an agent request may wait for the designer (for example, to approve something).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(330);

pub struct McpState {
    port: u16,
    token: String,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, Sender<String>>>,
    /// Set once the interface is listening. A request that arrives earlier would be lost.
    ready: AtomicBool,
}

/// The AI tools Duet's chat is running, by run: "chat" for the main conversation, and one for each task.
#[derive(Default)]
pub struct AgentState {
    children: Mutex<HashMap<String, Child>>,
}

/// A run's name goes into file names, so only plain letters, digits, dashes and colons stay.
fn run_tag(run: &str) -> String {
    run.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).take(48).collect()
}

fn json_header() -> tiny_http::Header {
    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap()
}

fn respond(req: tiny_http::Request, code: u16, body: &str) {
    let resp = tiny_http::Response::from_string(body)
        .with_status_code(code)
        .with_header(json_header());
    let _ = req.respond(resp);
}

const CLIENT_HEADER: &str = "X-Duet-Client";

/// Set on an AI tool Duet's own chat starts, holding its run. The tool hands its surroundings on to the
/// bridge it starts, so the bridge can tell the chat's AI from the same tool opened in a terminal.
const CHAT_RUN: &str = "DUET_CHAT_RUN";

/// A name that is safe to carry in one header line and to show: plain letters, digits and a few marks.
fn client_name(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric() || " .-_:/".contains(*c))
        .take(60)
        .collect::<String>()
        .trim()
        .to_string()
}

/// The name a bridge passes on: marked as the chat's when the chat started the tool, with its task if it has one.
fn chat_client(said: &str, run: Option<&str>) -> String {
    match run {
        Some("chat") => format!("chat:{said}"),
        Some(task) if !task.is_empty() => client_name(&format!("chat:{said}/{task}")),
        _ => said.to_string(),
    }
}

fn rpc_error(id: &Value, code: i64, message: &str) -> String {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}).to_string()
}

fn handle(mut req: tiny_http::Request, state: Arc<McpState>, app: AppHandle) {
    if req.url() != "/mcp" {
        return respond(req, 404, "{}");
    }
    let expected = format!("Bearer {}", state.token);
    let authorised = req
        .headers()
        .iter()
        .any(|h| h.field.equiv("Authorization") && h.value.as_str() == expected);
    if !authorised {
        return respond(req, 401, "{\"error\":\"unauthorised\"}");
    }
    // What the AI tool calls itself, so each step can say who made it. Only a name: it opens nothing.
    let client = req
        .headers()
        .iter()
        .find(|h| h.field.equiv(CLIENT_HEADER))
        .map(|h| client_name(h.value.as_str()))
        .filter(|n| !n.is_empty());
    if req.method() != &tiny_http::Method::Post {
        // We do not offer a server-to-agent event stream.
        return respond(req, 405, "{\"error\":\"use POST\"}");
    }
    let mut body = String::new();
    if req.as_reader().read_to_string(&mut body).is_err() {
        return respond(req, 400, "{}");
    }
    let parsed: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return respond(req, 400, &rpc_error(&Value::Null, -32700, "Parse error")),
    };
    // Notifications carry no id and expect no answer.
    let Some(rpc_id) = parsed.get("id").cloned() else {
        let _ = req.respond(tiny_http::Response::empty(202));
        return;
    };

    // An outside AI tool can ask in the moment Duet is still opening. Give the interface time.
    for _ in 0..150 {
        if state.ready.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if !state.ready.load(Ordering::SeqCst) {
        return respond(req, 200, &rpc_error(&rpc_id, -32603, "Duet is still opening. Try again in a moment."));
    }

    let activity = app.try_state::<Arc<crate::keepalive::Activity>>();
    let is_call = parsed["method"] == "tools/call";
    if let (true, Some(a)) = (is_call, activity.as_ref()) {
        a.touch();
    }
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel::<String>();
    state.pending.lock().unwrap().insert(id, tx);
    if app.emit("mcp-request", json!({"id": id, "body": parsed, "client": client})).is_err() {
        state.pending.lock().unwrap().remove(&id);
        return respond(req, 500, &rpc_error(&rpc_id, -32603, "Duet is not ready"));
    }
    let outcome = rx.recv_timeout(REQUEST_TIMEOUT);
    if let (true, Some(a)) = (is_call, activity.as_ref()) {
        a.touch();
    }
    match outcome {
        Ok(answer) => respond(req, 200, &answer),
        Err(_) => {
            state.pending.lock().unwrap().remove(&id);
            respond(req, 200, &rpc_error(&rpc_id, -32001, "Timed out waiting for Duet"));
        }
    }
}

/// Where Duet's own AI connection listens, and its password. For the web connection, which passes requests on.
pub(crate) fn local_address(app: &AppHandle) -> Option<(u16, String)> {
    let s = app.try_state::<Arc<McpState>>()?;
    Some((s.port, s.token.clone()))
}

/// Leave the address and secret in ~/.duet/session.json, readable only by this user,
/// so tools on this computer (and tests) can find the running Duet.
fn write_session_file(port: u16, token: &str) {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE"));
    let Ok(home) = home else { return };
    let dir = std::path::Path::new(&home).join(crate::duet_dir_name());
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = dir.join("session.json");
    let body = json!({"port": port, "token": token}).to_string();
    if std::fs::write(&file, body).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
        }
    }
}

/// Start the local server. Called once when the app starts.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or("no port")?;
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let state = Arc::new(McpState {
        port,
        token,
        next_id: AtomicU64::new(1),
        pending: Mutex::new(HashMap::new()),
        ready: AtomicBool::new(false),
    });
    write_session_file(port, &state.token);
    app.manage(state.clone());
    app.manage(AgentState::default());
    app.manage(Arc::new(crate::keepalive::Activity::default()));
    app.manage(Arc::new(crate::connect::ConnectState::default()));
    crate::connect::sweep(app);
    let app = app.clone();
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let state = state.clone();
            let app = app.clone();
            std::thread::spawn(move || handle(req, state, app));
        }
    });
    Ok(())
}

/// Address and secret for agents to connect with.
#[tauri::command]
pub fn mcp_info(state: State<Arc<McpState>>) -> Value {
    json!({"port": state.port, "token": state.token})
}

/// The interface says it is listening for requests from agents.
#[tauri::command]
pub fn mcp_ready(state: State<Arc<McpState>>) {
    state.ready.store(true, Ordering::SeqCst);
}

/// The command an outside AI tool runs to reach Duet: this app itself, started as a small bridge.
#[tauri::command]
pub fn bridge_command() -> Result<String, String> {
    let exe = crate::duet_exe()?;
    Ok(exe.to_string_lossy().to_string())
}

/// The interface answers a request that an agent made.
#[tauri::command]
pub fn mcp_reply(state: State<Arc<McpState>>, id: u64, response: String) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(response);
    }
}

#[cfg(unix)]
fn shell_command(program: &str, args: &[String]) -> Command {
    // Apps opened from the Dock do not get the terminal's PATH. Going through a login shell
    // finds tools the same way the terminal does.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut c = Command::new(shell);
    c.arg("-ilc").arg("exec \"$0\" \"$@\"").arg(program).args(args);
    c
}

#[cfg(windows)]
fn shell_command(program: &str, args: &[String]) -> Command {
    let mut c = crate::quiet_command("cmd");
    c.arg("/C").arg(program).args(args);
    c.env("PATH", windows_path());
    c
}

/// The folders Windows searches for programs, as they are now. Duet's own copy is taken when it
/// starts, so a tool installed after that (or by an installer that ran Duet) would stay missing.
#[cfg(windows)]
fn windows_path() -> std::ffi::OsString {
    let mut parts: Vec<String> = Vec::new();
    for key in [r"HKCU\Environment", r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"] {
        let Ok(out) = crate::quiet_command("reg").args(["query", key, "/v", "Path"]).stdin(Stdio::null()).output() else { continue };
        let text = String::from_utf8_lossy(&out.stdout);
        // a line reads "    Path    REG_EXPAND_SZ    C:\...;C:\..."
        let Some(value) = text.lines().find_map(|l| l.split_once("REG_EXPAND_SZ").or_else(|| l.split_once("REG_SZ")).map(|(_, v)| v.trim().to_string())) else { continue };
        parts.push(expand_windows_vars(&value));
    }
    if let Some(now) = std::env::var_os("PATH") {
        parts.push(now.to_string_lossy().to_string());
    }
    parts.join(";").into()
}

/// Fill in %NAME% from the environment, as Windows does for the PATH it keeps.
#[cfg(any(windows, test))]
fn expand_windows_vars(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// On Mac and Linux the agent runs in a session of its own. Everything it starts, such as the MCP
/// servers from its own settings, then belongs to that session and can be stopped with it. Without
/// this, a helper left behind when the agent ends can spin at full speed for hours.
#[cfg(unix)]
fn own_session(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
}

/// Stop the agent and everything it started. `pid` is the agent, which leads its own session.
#[cfg(unix)]
fn stop_session(pid: u32, signal: libc::c_int) {
    if pid > 1 {
        unsafe {
            libc::kill(-(pid as libc::pid_t), signal);
        }
    }
}

/// Tools Duet can look for.
fn known(program: &str) -> bool {
    matches!(program, "claude" | "agy" | "codex" | "opencode")
}

/// Tools Duet knows how to drive.
fn supported(program: &str) -> bool {
    matches!(program, "claude" | "agy")
}

/// Look for a program in the usual install folders, without starting a shell. Shells started
/// from inside an app can stall or skip the user's setup, which made installed tools look missing.
fn find_in_folders(program: &str) -> bool {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    #[cfg(windows)]
    let search = Some(windows_path());
    #[cfg(not(windows))]
    let search = std::env::var_os("PATH");
    let mut dirs: Vec<std::path::PathBuf> = search
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/usr/local/sbin",
    ] {
        dirs.push(d.into());
    }
    if !home.is_empty() {
        let h = std::path::Path::new(&home);
        for d in [
            ".npm-global/bin",
            ".local/bin",
            ".claude/local",
            ".bun/bin",
            ".volta/bin",
            ".cargo/bin",
            "AppData/Roaming/npm",
            "AppData/Local/Programs/Antigravity/bin",
            "AppData/Local/agy/bin",
        ] {
            dirs.push(h.join(d));
        }
        // Node version managers keep tools in a folder named after the version.
        if let Ok(rd) = std::fs::read_dir(h.join(".nvm/versions/node")) {
            for v in rd.flatten() {
                dirs.push(v.path().join("bin"));
            }
        }
    }
    let names: Vec<String> = if cfg!(windows) {
        ["", ".exe", ".cmd", ".bat"].iter().map(|e| format!("{program}{e}")).collect()
    } else {
        vec![program.to_string()]
    };
    dirs.iter().any(|d| names.iter().any(|n| d.join(n).is_file()))
}

/// The models a tool offers, as (id, name) pairs. Only Antigravity can list them. Starting the tool
/// takes seconds, so this runs off the main thread: a window that waits on it freezes.
#[tauri::command(async)]
pub fn agent_models(program: String) -> Vec<Value> {
    if program != "agy" {
        return Vec::new();
    }
    let Ok(out) = shell_command("agy", &["models".into()]).stdin(Stdio::null()).output() else {
        return Vec::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let (id, name) = l.split_once('\t')?;
            Some(json!({"id": id.trim(), "name": name.trim()}))
        })
        .collect()
}

/// Is this agent tool installed on this computer?
#[tauri::command(async)]
pub fn agent_available(program: String) -> bool {
    if !known(&program) {
        return false;
    }
    if find_in_folders(&program) {
        return true;
    }
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        Command::new(shell)
            .args(["-ilc", "command -v \"$0\"", &program])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        crate::quiet_command("where")
            .arg(&program)
            .env("PATH", windows_path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

/// Put the agent's instructions and connection details in files, so nothing tricky has to be
/// squeezed through a command line (quotes and line breaks break differently on every system).
/// The connection file holds the secret token, so only this user may read it.
#[tauri::command(async)]
pub fn write_agent_files(system: String, mcp: String, run: Option<String>) -> Result<Value, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not find your home folder.".to_string())?;
    let dir = std::path::Path::new(&home).join(crate::duet_dir_name()).join("agent-workspace");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let write = |name: &str, body: &str| -> Result<String, String> {
        let file = dir.join(name);
        std::fs::write(&file, body).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
        }
        Ok(file.to_string_lossy().to_string())
    };
    // each run has its own pair, so two AIs at work at once never read each other's connection
    let tag = run.as_deref().filter(|r| *r != "chat").map(|r| format!("-{}", run_tag(r))).unwrap_or_default();
    Ok(json!({"system": write(&format!("system{tag}.md"), &system)?, "mcp": write(&format!("mcp{tag}.json"), &mcp)?}))
}

/// Write one file inside Duet's agent workspace (for tools that read their settings from the
/// folder they run in). Only plain relative paths are accepted, so nothing can escape the workspace.
#[tauri::command(async)]
pub fn write_agent_file(name: String, body: String) -> Result<String, String> {
    let rel = std::path::Path::new(&name);
    let plain = !name.is_empty()
        && rel.is_relative()
        && rel.components().all(|c| matches!(c, std::path::Component::Normal(_)));
    if !plain {
        return Err("That file name is not allowed.".to_string());
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not find your home folder.".to_string())?;
    let file = std::path::Path::new(&home).join(crate::duet_dir_name()).join("agent-workspace").join(rel);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    }
    Ok(file.to_string_lossy().to_string())
}

/// Start the agent. Its output arrives as `agent-line` events, and `agent-exit` ends the run. Each
/// event carries the run it belongs to, so several can be at work at once.
#[tauri::command]
pub fn agent_run(
    app: AppHandle,
    state: State<AgentState>,
    program: String,
    args: Vec<String>,
    input: String,
    cwd: Option<String>,
    run: Option<String>,
) -> Result<(), String> {
    if !supported(&program) {
        return Err(format!("{program} is not supported yet."));
    }
    let run = run.unwrap_or_else(|| "chat".to_string());
    if state.children.lock().unwrap().contains_key(&run) {
        return Err("Duet is already working on something.".to_string());
    }
    let mut cmd = shell_command(&program, &args);
    cmd.env(CHAT_RUN, &run);
    if let Some(dir) = cwd {
        let _ = std::fs::create_dir_all(&dir);
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    own_session(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("Could not start {program}: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    state.children.lock().unwrap().insert(run.clone(), child);

    if let Some(err) = stderr {
        let app = app.clone();
        let run = run.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                let _ = app.emit("agent-stderr", json!({"run": run, "line": line}));
            }
        });
    }
    std::thread::spawn(move || {
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = app.emit("agent-line", json!({"run": run, "line": line}));
            }
        }
        let code = {
            let state = app.state::<AgentState>();
            let child = state.children.lock().unwrap().remove(&run);
            match child {
                Some(mut c) => {
                    let code = c.wait().ok().and_then(|s| s.code());
                    // the agent is done: clear away any helper it left running
                    #[cfg(unix)]
                    stop_session(c.id(), libc::SIGTERM);
                    code
                }
                None => None,
            }
        };
        let _ = app.emit("agent-exit", json!({"run": run, "code": code}));
    });
    Ok(())
}

/// Stop the agent mid-task.
#[tauri::command]
pub fn agent_cancel(state: State<AgentState>, run: Option<String>) {
    // the slot is emptied now, so a tool that was stopped never leaves "already working" behind
    let child = state.children.lock().unwrap().remove(run.as_deref().unwrap_or("chat"));
    if let Some(mut child) = child {
        #[cfg(unix)]
        stop_session(child.id(), libc::SIGKILL);
        let _ = child.kill();
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
}

/// A request from an outside AI is waiting for the interface to answer.
pub fn request_waiting(app: &AppHandle) -> bool {
    app.try_state::<Arc<McpState>>().is_some_and(|s| !s.pending.lock().unwrap().is_empty())
}

/// Duet's own chat has an AI tool running.
pub fn chat_agent_running(app: &AppHandle) -> bool {
    app.try_state::<AgentState>().is_some_and(|s| !s.children.lock().unwrap().is_empty())
}

/// Called when Duet quits: an AI it started must not be left running behind it.
pub fn stop_agent(app: &AppHandle) {
    use tauri::Manager;
    if let Some(state) = app.try_state::<AgentState>() {
        for child in state.children.lock().unwrap().values_mut() {
            #[cfg(unix)]
            stop_session(child.id(), libc::SIGKILL);
            let _ = child.kill();
        }
    }
}

const CLOSED: &str = "Duet is not open. Ask the designer to open Duet, then try again.";

/// What the bridge says by itself while Duet is closed. An AI tool that starts before Duet still
/// connects and learns what Duet can do (from what Duet left behind the last time it ran), and is
/// told to open Duet when it tries to use it.
fn offline_answer(request: &Value, left_behind: Option<&Value>) -> Option<String> {
    let id = request.get("id")?;
    let result = match request["method"].as_str()? {
        "initialize" => json!({
            "protocolVersion": request["params"]["protocolVersion"].as_str().unwrap_or("2025-03-26"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "duet", "version": left_behind.and_then(|c| c["version"].as_str()).unwrap_or("")},
            "instructions": left_behind.and_then(|c| c["instructions"].as_str()).unwrap_or(CLOSED),
        }),
        "ping" => json!({}),
        "tools/list" => json!({"tools": left_behind?.get("tools")?}),
        "tools/call" => json!({"content": [{"type": "text", "text": CLOSED}], "isError": true}),
        _ => return None,
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string())
}

/// Runs as `duet --mcp-bridge`: speaks MCP over stdin and stdout for AI tools that are told about a
/// command, not a changing address (Claude Code in a terminal, Claude desktop, Cursor, Codex,
/// Antigravity). Each request is passed on to the Duet that is running right now, found through
/// ~/.duet/session.json, so the bridge is set up once and keeps working when Duet is restarted.
/// How long the bridge waits for Duet to open before telling the AI it could not.
const OPEN_WAIT: std::time::Duration = std::time::Duration::from_secs(40);

/// Open Duet with no window, for an AI that called a tool while it was closed.
fn open_for_ai() {
    use std::process::{Command, Stdio};
    let Ok(exe) = crate::duet_exe() else { return };
    // the installed app opens through the system, so a later click on its icon finds this same copy
    #[cfg(target_os = "macos")]
    if let Some(bundle) = exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")) {
        let _ = Command::new("open").arg("-g").arg("-a").arg(bundle).args(["--args", crate::keepalive::BACKGROUND_ARG]).spawn();
        return;
    }
    let mut cmd = crate::quiet_command(exe);
    cmd.arg(crate::keepalive::BACKGROUND_ARG);
    // Duet dev is found and closed by this word (scripts/dev-duet.sh)
    if std::env::var_os("DUET_DEV").is_some() {
        cmd.arg("DUET_DEV_MARK");
    }
    let _ = cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
}

pub fn bridge() {
    use std::io::Read;
    use std::net::TcpStream;

    let duet_dir = || -> Option<std::path::PathBuf> {
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()?;
        Some(std::path::Path::new(&home).join(crate::duet_dir_name()))
    };
    let read_json = |file: std::path::PathBuf| -> Option<Value> {
        serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()
    };
    // The answer from the running Duet, or nothing if it is closed or something else took its place.
    let forward = |line: &str, client: &str| -> Option<String> {
        let session = read_json(duet_dir()?.join("session.json"))?;
        let (port, token) = (session["port"].as_u64()? as u16, session["token"].as_str()?.to_string());
        let mut conn = TcpStream::connect(("127.0.0.1", port)).ok()?;
        let req = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\n{CLIENT_HEADER}: {client}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{line}",
            line.len()
        );
        conn.write_all(req.as_bytes()).ok()?;
        let mut raw = Vec::new();
        let _ = conn.read_to_end(&mut raw);
        let body = http_body(&raw).trim().replace('\n', " ");
        let answer: Value = serde_json::from_str(&body).ok()?;
        answer.get("jsonrpc").map(|_| body)
    };

    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    // The AI tool says who it is once, when it connects. The bridge passes that on with every request.
    let mut client = String::new();
    // when this bridge last opened Duet, so a slow start is not answered with a second copy
    let mut opened: Option<std::time::Instant> = None;
    for line in stdin.lock().lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        if request["method"] == "initialize" {
            let said = client_name(request["params"]["clientInfo"]["name"].as_str().unwrap_or(""));
            if !said.is_empty() {
                client = chat_client(&said, std::env::var(CHAT_RUN).ok().as_deref());
            }
        }
        // making a new file needs no open Duet, so the bridge answers it itself
        let file_tool = request["method"] == "tools/call" && request["params"]["name"].as_str().is_some_and(|n| crate::files::TOOL_NAMES.contains(&n));
        let answer = if file_tool && request.get("id").is_some() {
            Some(crate::files::call(request["params"]["name"].as_str().unwrap_or(""), &request["params"]["arguments"], &request["id"]))
        } else {
            let said = forward(&line, &client).or_else(|| {
                // a tool call needs Duet itself: open it with no window and wait until it answers
                if request["method"] != "tools/call" {
                    return None;
                }
                if opened.is_none_or(|t: std::time::Instant| t.elapsed() > OPEN_WAIT) {
                    open_for_ai();
                    opened = Some(std::time::Instant::now());
                }
                let start = std::time::Instant::now();
                while start.elapsed() < OPEN_WAIT {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if let Some(answer) = forward(&line, &client).filter(|a| !a.contains("still opening") && !a.contains("not ready")) {
                        return Some(answer);
                    }
                }
                None
            }).or_else(|| {
                let left_behind = duet_dir().and_then(|d| read_json(d.join("agent-workspace").join("bridge.json")));
                offline_answer(&request, left_behind.as_ref())
            });
            if request["method"] == "tools/list" { said.map(|a| crate::files::add_to_list(&a)) } else { said }
        };
        // Notifications carry no id and expect no answer.
        let Some(id) = request.get("id") else { continue };
        let body = answer.unwrap_or_else(|| rpc_error(id, -32603, "Duet is not open. Open Duet first."));
        let _ = writeln!(out, "{body}");
        let _ = out.flush();
    }
}

/// Make sure Antigravity knows about Duet. Added once, to Antigravity's own list, and only when it
/// is missing or points at a Duet that has moved.
#[tauri::command(async)]
pub fn agy_connect() -> Result<(), String> {
    let exe = crate::duet_exe()?;
    let exe = exe.to_string_lossy().to_string();
    let listed = shell_command("agy", &["mcp".into(), "list".into()])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Could not start agy: {e}"))?;
    let text = String::from_utf8_lossy(&listed.stdout);
    if text.lines().any(|l| l.trim_start().starts_with("duet ") && l.contains(&exe)) {
        return Ok(());
    }
    let added = shell_command(
        "agy",
        &["mcp".into(), "add".into(), "duet".into(), exe, "--mcp-bridge".into()],
    )
    .stdin(Stdio::null())
    .output()
    .map_err(|e| e.to_string())?;
    if added.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&added.stderr).to_string())
    }
}

/// The body of a raw HTTP response. Big answers arrive in chunks, each led by its size in hex.
pub(crate) fn http_body(raw: &[u8]) -> String {
    let Some(split) = raw.windows(4).position(|w| w == b"\r\n\r\n") else {
        return String::new();
    };
    let head = String::from_utf8_lossy(&raw[..split]).to_lowercase();
    let body = &raw[split + 4..];
    if !head.contains("transfer-encoding: chunked") {
        return String::from_utf8_lossy(body).to_string();
    }
    let mut out = Vec::new();
    let mut rest = body;
    loop {
        let Some(eol) = rest.windows(2).position(|w| w == b"\r\n") else { break };
        let size_text = String::from_utf8_lossy(&rest[..eol]);
        let Ok(size) = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16) else { break };
        rest = &rest[eol + 2..];
        if size == 0 || rest.len() < size {
            if size > 0 {
                out.extend_from_slice(rest);
            }
            break;
        }
        out.extend_from_slice(&rest[..size]);
        rest = rest.get(size + 2..).unwrap_or(&[]);
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod bridge_tests {
    use super::{chat_client, expand_windows_vars, http_body, offline_answer};
    use serde_json::{json, Value};

    #[test]
    fn tells_the_chats_ai_from_one_in_a_terminal() {
        assert_eq!(chat_client("antigravity", None), "antigravity");
        assert_eq!(chat_client("antigravity", Some("chat")), "chat:antigravity");
        assert_eq!(chat_client("antigravity", Some("task:abc1")), "chat:antigravity/task:abc1");
    }

    #[test]
    fn answers_for_duet_while_it_is_closed() {
        let left = json!({"version": "9", "instructions": "how to work", "tools": [{"name": "get_context"}]});
        let ask = |method: &str| json!({"jsonrpc": "2.0", "id": 7, "method": method, "params": {"protocolVersion": "2025-06-18"}});
        let reply = |method: &str, left: Option<&Value>| -> Value {
            serde_json::from_str(&offline_answer(&ask(method), left).unwrap()).unwrap()
        };
        let hello = reply("initialize", Some(&left));
        assert_eq!(hello["id"], 7);
        assert_eq!(hello["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(hello["result"]["instructions"], "how to work");
        assert_eq!(reply("tools/list", Some(&left))["result"]["tools"][0]["name"], "get_context");
        let call = reply("tools/call", Some(&left));
        assert_eq!(call["result"]["isError"], true);
        assert!(call["result"]["content"][0]["text"].as_str().unwrap().contains("open Duet"));
        // Duet has never run here: it can still say hello, but has no list of tools to give.
        assert_eq!(reply("initialize", None)["result"]["serverInfo"]["name"], "duet");
        assert!(offline_answer(&ask("tools/list"), None).is_none());
        // a notification expects no answer
        assert!(offline_answer(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}), Some(&left)).is_none());
    }

    #[test]
    fn windows_folders_fill_in_their_names() {
        std::env::set_var("DUET_TEST_HOME", r"C:\Users\A B");
        assert_eq!(expand_windows_vars(r"%DUET_TEST_HOME%\agy\bin;C:\x"), r"C:\Users\A B\agy\bin;C:\x");
        // a name nobody set, and a lone percent, stay as written
        assert_eq!(expand_windows_vars(r"%NOT_SET_ANYWHERE%\bin;50%"), r"%NOT_SET_ANYWHERE%\bin;50%");
    }

    #[test]
    fn plain_body() {
        assert_eq!(http_body(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}"), "{}");
    }

    #[test]
    fn chunked_body() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
        assert_eq!(http_body(raw), "hello world");
    }
}

#[cfg(all(test, unix))]
mod session_tests {
    use super::{own_session, stop_session};
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    fn alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    /// The agent starts helpers of its own. Stopping the agent must stop them too.
    #[test]
    fn stopping_the_agent_stops_what_it_started() {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("sleep 60 & echo $!; wait").stdout(Stdio::piped());
        own_session(&mut cmd);
        let mut child = cmd.spawn().unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let helper: i32 = line.trim().parse().unwrap();
        assert!(alive(helper));

        stop_session(child.id(), libc::SIGKILL);
        let _ = child.wait();
        for _ in 0..40 {
            if !alive(helper) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        panic!("the helper was left running");
    }
}
