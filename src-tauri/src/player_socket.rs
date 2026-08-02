// ----------------------------------------------------------------------------
// mpv's JSON IPC, over a unix socket
//
// Shared by the two backends that drive a real mpv process through one: X11
// (player.rs) and macOS (player_macos.rs). Windows speaks the same protocol
// down a named pipe, which has no read timeout the way a socket does and needs
// its own connect retry, so it keeps its own copy in player_windows.rs.
// ----------------------------------------------------------------------------

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Where this process's mpv keeps its socket and its log, both wiped first so a
/// stale file from a killed run can't be read as the new one's.
///
/// Short paths on purpose: AF_UNIX is limited to ~108 bytes.
pub fn paths() -> (PathBuf, PathBuf) {
	let dir = std::env::temp_dir();
	let pid = std::process::id();
	let ipc = dir.join(format!("ventic-mpv-{pid}.sock"));
	let log = dir.join(format!("ventic-mpv-{pid}.log"));
	let _ = std::fs::remove_file(&ipc);
	let _ = std::fs::remove_file(&log);
	(ipc, log)
}

/// Relay one JSON command object and return mpv's response line.
/// `command` is a full mpv IPC object, e.g. `{"command":["cycle","pause"]}`.
pub fn command(path: &Path, command: &str) -> Result<String, String> {
	let mut stream = UnixStream::connect(path).map_err(|e| format!("mpv not ready: {e}"))?;
	// Most commands answer in microseconds, but `sub-add` downloads the subtitle
	// file over http before replying, so the window has to cover a slow server.
	stream.set_read_timeout(Some(Duration::from_secs(5))).ok();

	let mut line = command.trim().to_string();
	line.push('\n');
	stream.write_all(line.as_bytes()).map_err(|e| e.to_string())?;

	// Command responses carry an "error" field and no "event" field; async
	// event lines carry "event" (and some, like end-file, even contain
	// "reason":"error"). Skip events and return the first real response.
	let reader = BufReader::new(stream);
	for line in reader.lines() {
		let line = line.map_err(|e| e.to_string())?;
		if !line.contains("\"event\"") && line.contains("\"error\"") {
			return Ok(line);
		}
	}
	Err("no response from mpv".into())
}

/// Read several mpv properties over a single socket connection.
///
/// The frontend polls half a dozen of these a few times a second, and a
/// connect/write/read round trip *each* is the difference between a smooth
/// progress bar and a stuttering one. Requests are pipelined and matched back up
/// by `request_id`; a property that fails comes back as null.
pub fn properties(path: &Path, names: &[String]) -> Result<String, String> {
	let mut stream = UnixStream::connect(path).map_err(|e| format!("mpv not ready: {e}"))?;
	stream.set_read_timeout(Some(Duration::from_secs(2))).ok();

	let mut req = String::new();
	for (i, name) in names.iter().enumerate() {
		req.push_str(
			&serde_json::json!({ "command": ["get_property", name], "request_id": i }).to_string(),
		);
		req.push('\n');
	}
	stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;

	let mut out = serde_json::Map::new();
	for line in BufReader::new(stream).lines() {
		let Ok(line) = line else { break };
		let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
		// Async event lines carry no request_id and are not answers to anything.
		let Some(id) = msg.get("request_id").and_then(|v| v.as_u64()) else { continue };
		let Some(name) = names.get(id as usize) else { continue };
		let ok = msg.get("error").and_then(|e| e.as_str()) == Some("success");
		let value = if ok { msg.get("data").cloned().unwrap_or(serde_json::Value::Null) } else { serde_json::Value::Null };
		out.insert(name.clone(), value);
		if out.len() == names.len() {
			break;
		}
	}
	Ok(serde_json::Value::Object(out).to_string())
}

/// The part of mpv's own log worth showing, so a player that died says why
/// instead of leaving a black rectangle behind.
pub fn log_tail(path: &Path) -> Option<String> {
	std::fs::read_to_string(path).ok().map(|s| {
		// mpv tags every line with its level — "[ 2.06][e][stream] Failed to
		// open …". Match on that rather than on the word "error", which also
		// occurs in the build flags mpv prints in its header (-Wno-error=…)
		// and would push the real failure out of the excerpt.
		let lines: Vec<&str> =
			s.lines().filter(|l| l.contains("][e]") || l.contains("][fatal]")).collect();
		let tail = if lines.is_empty() { s.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>() } else { lines };
		tail.join("\n").chars().take(1200).collect()
	})
}
