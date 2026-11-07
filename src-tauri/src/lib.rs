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
            oauth_listen
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
