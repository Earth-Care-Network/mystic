//! Mystic by Earth Care Network — the desktop shell.
//!
//! The app's logic lives in TypeScript (`src/core`). This shell gives it what a
//! webview can't have on its own: the OS keychain for keys and tokens, the
//! `~/Mystic` folder the person can open, a one-shot loopback listener for the
//! Earth Care Network sign-in (RFC 8252), HTTP without CORS, and auto-updates.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const SERVICE: &str = "network.earthcare.mystic";

fn valid_secret_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 80 && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    if !valid_secret_name(&name) {
        return Err("That key name isn't allowed.".into());
    }
    keyring::Entry::new(SERVICE, &name)
        .and_then(|e| e.set_password(&value))
        .map_err(|e| format!("The keychain refused to save it: {e}"))
}

#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    if !valid_secret_name(&name) {
        return Err("That key name isn't allowed.".into());
    }
    match keyring::Entry::new(SERVICE, &name).and_then(|e| e.get_password()) {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("The keychain refused to read it: {e}")),
    }
}

#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    if !valid_secret_name(&name) {
        return Err("That key name isn't allowed.".into());
    }
    match keyring::Entry::new(SERVICE, &name).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("The keychain refused to delete it: {e}")),
    }
}

/// `~/Mystic` (or `MYSTIC_HOME`): agents, chats, memory and notes as plain files.
fn home() -> Result<PathBuf, String> {
    let root = std::env::var_os("MYSTIC_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join("Mystic")))
        .ok_or("There's no home folder.")?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

/// A path inside the Mystic folder: relative, no `..`, no root, no drive, and no symlink
/// anywhere on the way that leads out of the folder (a synced or shared folder could plant one).
fn inside(rel: &str) -> Result<PathBuf, String> {
    const OUTSIDE: &str = "That path is outside the Mystic folder.";
    let p = Path::new(rel);
    if rel.is_empty() || rel.len() > 400 || p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(OUTSIDE.into());
    }
    let root = home()?.canonicalize().map_err(|e| e.to_string())?;
    let full = root.join(p);
    // The file itself is never a symlink.
    if std::fs::symlink_metadata(&full).map(|m| m.file_type().is_symlink()).unwrap_or(false) {
        return Err(OUTSIDE.into());
    }
    // The deepest folder on the way that exists resolves inside the Mystic folder.
    let mut probe = full.parent().map(Path::to_path_buf);
    while let Some(dir) = probe {
        if dir.exists() {
            let real = dir.canonicalize().map_err(|e| e.to_string())?;
            if !real.starts_with(&root) {
                return Err(OUTSIDE.into());
            }
            break;
        }
        probe = dir.parent().map(Path::to_path_buf);
    }
    Ok(full)
}

#[tauri::command]
fn workspace_dir() -> Result<String, String> {
    Ok(home()?.to_string_lossy().into_owned())
}

#[tauri::command]
fn ws_read(path: String) -> Result<Option<String>, String> {
    let p = inside(&path)?;
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn ws_write(path: String, text: String) -> Result<(), String> {
    let p = inside(&path)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Write a new temp file (never through an existing one), then rename, so a crash never
    // leaves half a file.
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tmp = p.with_file_name(format!(".{name}.{}-{nanos}.mystic-tmp", std::process::id()));
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|e| e.to_string())?;
    if let Err(e) = f.write_all(text.as_bytes()).and_then(|_| f.sync_all()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
fn ws_list(dir: String) -> Result<Vec<String>, String> {
    let p = inside(&dir)?;
    let Ok(read) = std::fs::read_dir(&p) else { return Ok(vec![]) };
    let mut names: Vec<String> = read
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| !n.starts_with('.') && !n.ends_with(".mystic-tmp"))
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
fn ws_delete(path: String) -> Result<(), String> {
    let p = inside(&path)?;
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Clone, Serialize)]
struct OAuthCallback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><meta name=color-scheme content=\"light dark\"><title>Mystic</title>\
<body style=\"font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0;background:Canvas;color:CanvasText\">\
<div style=\"text-align:center\"><h1 style=\"font-weight:600;color:#9362c4\">Back to Mystic</h1><p>Mystic is finishing your sign-in. You can close this tab.</p></div>";

/// Listen on 127.0.0.1 for the sign-in redirect that carries `state`; answers the port.
/// The callback arrives as the `oauth-callback` event. A request with another state (a
/// stray local probe) gets a 400 and the listener keeps waiting; after five minutes it
/// emits `{error: "timeout"}` so the app never waits forever.
#[tauri::command]
fn oauth_listen(app: AppHandle, state: String) -> Result<u16, String> {
    if state.len() < 16 || state.len() > 128 {
        return Err("That sign-in state isn't valid.".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(300);
        while std::time::Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut line = String::new();
                    // One request line, at most 8 KB: a local process can't grow this forever.
                    let _ = BufReader::new((&stream).take(8192)).read_line(&mut line);
                    let target = line.split_whitespace().nth(1).unwrap_or("/");
                    let parsed = url::Url::parse(&format!("http://127.0.0.1{target}")).ok();
                    if parsed.as_ref().map(|u| u.path()) != Some("/callback") {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        continue;
                    }
                    let q = |k: &str| parsed.as_ref().and_then(|u| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()));
                    if q("state").as_deref() != Some(state.as_str()) {
                        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        continue;
                    }
                    let payload = OAuthCallback { code: q("code"), state: q("state"), error: q("error") };
                    let body = DONE_PAGE.as_bytes();
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(body);
                    let _ = app.emit("oauth-callback", payload);
                    return;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
                Err(_) => break,
            }
        }
        // Carries this listener's state, so it can only end the sign-in that started it.
        let _ = app.emit("oauth-callback", OAuthCallback { code: None, state: Some(state), error: Some("timeout".into()) });
    });
    Ok(port)
}

// ---- web fetch ----------------------------------------------------------------

#[derive(Serialize)]
struct Fetched {
    url: String,
    status: u16,
    content_type: String,
    text: String,
    truncated: bool,
}

/// An address an agent may reach: public unicast only (no loopback, private, link-local,
/// CGNAT, multicast, metadata or documentation ranges).
fn public_ip(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_broadcast()
                || v.is_documentation()
                || v.is_unspecified()
                || v.is_multicast()
                || o[0] == 0
                || (o[0] == 100 && (64..128).contains(&o[1]))
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)
                || o[0] >= 240)
        }
        IpAddr::V6(v) => {
            if let Some(v4) = v.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(v4));
            }
            let s = v.segments();
            !(v.is_loopback() || v.is_unspecified() || v.is_multicast() || (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80)
        }
    }
}

fn html_to_text(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len() / 3);
    let mut i = 0;
    let bytes = html.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'<' {
            // Drop script, style, noscript, svg and head bodies entirely.
            let mut skipped = false;
            for tag in ["script", "style", "noscript", "svg", "head", "template"] {
                if lower[i + 1..].starts_with(tag) {
                    if let Some(end) = lower[i..].find(&format!("</{tag}")) {
                        i += end;
                        if let Some(close) = lower[i..].find('>') {
                            i += close + 1;
                        }
                        skipped = true;
                    }
                    break;
                }
            }
            if skipped {
                continue;
            }
            let block = ["<p", "<br", "<div", "<li", "<h1", "<h2", "<h3", "<h4", "<tr", "</p", "</div", "</li", "</h", "</tr"]
                .iter()
                .any(|t| lower[i..].starts_with(t));
            match lower[i..].find('>') {
                Some(close) => i += close + 1,
                None => break,
            }
            out.push(if block { '\n' } else { ' ' });
            continue;
        }
        let ch = html[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    let mut lines: Vec<String> = Vec::new();
    for line in out.lines() {
        let t = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if !t.is_empty() {
            lines.push(t);
        }
    }
    lines.join("\n")
}

/// Fetch one public web page for an agent: https or http on the standard ports, every
/// hop resolved and checked (redirects included), the connection pinned to the checked
/// address, 20 s, 2 MB read, text out (HTML reduced to its words).
#[tauri::command]
async fn web_fetch(url: String) -> Result<Fetched, String> {
    use tauri_plugin_http::reqwest;
    let mut current = url::Url::parse(url.trim()).map_err(|_| "That isn't a web address.".to_string())?;
    for _hop in 0..4 {
        if !matches!(current.scheme(), "https" | "http") || !current.username().is_empty() || current.password().is_some() {
            return Err("Only plain http(s) web addresses can be fetched.".into());
        }
        let host = current.host_str().ok_or("That address has no host.")?.to_string();
        let port = current.port_or_known_default().ok_or("That address has no port.")?;
        if port != 443 && port != 80 {
            return Err("Only the standard web ports (80, 443) can be fetched.".into());
        }
        let addrs: Vec<std::net::SocketAddr> = tokio_lookup(&host, port).await?;
        let addr = *addrs.first().ok_or("That host didn't resolve.")?;
        if addrs.iter().any(|a| !public_ip(a.ip())) {
            return Err("That address points inside your network, so Mystic won't fetch it.".into());
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .resolve(&host, addr)
            .user_agent("Mystic/0.2 (+https://earth-care-network.github.io/mystic)")
            .build()
            .map_err(|e| e.to_string())?;
        let mut res = client.get(current.clone()).send().await.map_err(|e| format!("Couldn't fetch it: {e}"))?;
        let status = res.status();
        if status.is_redirection() {
            let loc = res.headers().get("location").and_then(|v| v.to_str().ok()).ok_or("A redirect with no address.")?;
            current = current.join(loc).map_err(|_| "A redirect to an invalid address.".to_string())?;
            continue;
        }
        let content_type = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let mut body: Vec<u8> = Vec::new();
        let mut truncated = false;
        while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
            body.extend_from_slice(&chunk);
            if body.len() > 2 * 1024 * 1024 {
                truncated = true;
                break;
            }
        }
        let raw = String::from_utf8_lossy(&body).into_owned();
        let mut text = if content_type.contains("html") || raw.trim_start().starts_with('<') { html_to_text(&raw) } else { raw };
        if text.chars().count() > 20_000 {
            text = text.chars().take(20_000).collect();
            truncated = true;
        }
        return Ok(Fetched { url: current.to_string(), status: status.as_u16(), content_type, text, truncated });
    }
    Err("Too many redirects.".into())
}

async fn tokio_lookup(host: &str, port: u16) -> Result<Vec<std::net::SocketAddr>, String> {
    let target = format!("{host}:{port}");
    tauri::async_runtime::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        target.to_socket_addrs().map(|a| a.collect::<Vec<_>>()).map_err(|_| "That host didn't resolve.".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests_web {
    use super::*;
    #[test]
    fn private_addresses_are_refused() {
        for ip in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["93.184.216.34", "2606:4700::1111"] {
            assert!(public_ip(ip.parse().unwrap()), "{ip}");
        }
    }
    #[test]
    fn html_becomes_words() {
        let t = html_to_text("<html><head><title>x</title></head><body><script>evil()</script><h1>Hi</h1><p>One &amp; two</p></body></html>");
        assert!(t.contains("Hi") && t.contains("One & two") && !t.contains("evil"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Phones sign in through network.earthcare.mystic:/oauth/callback (RFC 8252 §7.1).
        .plugin(tauri_plugin_deep_link::init());
    // Desktop updates itself from signed releases; phones update through the App Store.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .invoke_handler(tauri::generate_handler![
            secret_set,
            secret_get,
            secret_delete,
            workspace_dir,
            ws_read,
            ws_write,
            ws_list,
            ws_delete,
            oauth_listen,
            web_fetch
        ])
        .run(tauri::generate_context!())
        .expect("Mystic failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_folder() {
        std::env::set_var("MYSTIC_HOME", std::env::temp_dir().join("mystic-test-home"));
        assert!(inside("agents/chief-of-staff.json").is_ok());
        assert!(inside("../etc/passwd").is_err());
        assert!(inside("/etc/passwd").is_err());
        assert!(inside("a/../../b").is_err());
        assert!(inside("").is_err());
    }

    #[test]
    fn secret_names_are_plain() {
        assert!(valid_secret_name("provider.openrouter"));
        assert!(!valid_secret_name("../x"));
        assert!(!valid_secret_name(""));
    }
}
