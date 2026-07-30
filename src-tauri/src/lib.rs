#[cfg(desktop)]
use tauri::{
	menu::{Menu, MenuItem},
	tray::TrayIconBuilder
};
use tauri::Manager;

use std::path::PathBuf;
use std::time::Duration;

use librqbit::{
	api::Api, dht::DhtPersistenceConfig, http_api::HttpApi, DhtSessionConfig, Session,
	SessionOptions, SessionPersistenceConfig
};
use librqbit_dualstack_sockets::TcpListener;

// The embedded player is an mpv process parented into a child window of the app
// window, which is X11 on Linux and an HWND on Windows. macOS and Android have
// neither, so there the same commands compile as stubs that report why playback
// is unavailable.
#[cfg_attr(target_os = "linux", path = "player.rs")]
#[cfg_attr(target_os = "windows", path = "player_windows.rs")]
#[cfg_attr(not(any(target_os = "linux", target_os = "windows")), path = "player_unsupported.rs")]
mod player;

/// Drops the quotes `tauri-plugin-deep-link` puts around the binary path in the
/// `Exec=` line it writes.
///
/// The quotes are legal per the desktop entry spec and GIO parses them, which is
/// why a `ventic://` link works from Firefox. xdg-open runs the value through its
/// own parser instead, keeps the quotes as part of the word, and bails out when
/// `command -v '"/path/to/ventic"'` finds nothing — silently, falling through to
/// opening a browser. Every Chromium-based browser hands external schemes to
/// xdg-open, so until the quotes come off the link does nothing in Chrome, Brave
/// or Edge, with no error anywhere to explain it.
#[cfg(target_os = "linux")]
fn unquote_exec(entry: &str) -> String {
	let mut out = entry
		.lines()
		.map(|line| {
			match line.strip_prefix("Exec=\"").and_then(|rest| rest.strip_suffix("\" %u")) {
				// A path containing a space genuinely needs the quotes to
				// survive GIO, and xdg-open misreads it either way, so leave it be.
				// Escaping it the way both parsers accept is upstream's problem.
				Some(exec) if !exec.contains(' ') => format!("Exec={exec} %u"),
				_ => line.to_string(),
			}
		})
		.collect::<Vec<_>>()
		.join("\n");
	out.push('\n');
	out
}

/// Claims `stremio://` on first run, but only when nothing else answers it.
///
/// The audience for this app overlaps Stremio's almost exactly, so assuming the
/// scheme is free would break the other app on the machines most likely to have
/// it. Runs once — after that the settings toggle owns the decision, and a user
/// who turned it off does not get it back on the next launch.
#[cfg(target_os = "linux")]
fn claim_stremio_if_free(app: &tauri::AppHandle) {
	use tauri_plugin_deep_link::DeepLinkExt;

	let Ok(marker) = app.path().app_data_dir().map(|d| d.join("stremio-scheme-checked")) else {
		return;
	};
	if marker.exists() {
		return;
	}

	// No output means no .desktop entry owns the scheme. A missing xdg-mime says
	// nothing either way, so leave the association alone rather than guess.
	let free = std::process::Command::new("xdg-mime")
		.args(["query", "default", "x-scheme-handler/stremio"])
		.output()
		.is_ok_and(|o| o.stdout.iter().all(u8::is_ascii_whitespace));

	if free {
		let _ = app.deep_link().register("stremio");
	}

	if let Some(dir) = marker.parent() {
		let _ = std::fs::create_dir_all(dir);
	}
	let _ = std::fs::write(&marker, "");
}

// Linux only. Windows `register` writes HKCU, which shadows the HKLM
// key a Stremio install writes, so auto-claiming there would silently steal the
// scheme — and reading the conflict back needs a registry crate for one check.
// The settings toggle already covers it. Add winreg if Windows users complain.
#[cfg(all(desktop, not(target_os = "linux")))]
fn claim_stremio_if_free(_app: &tauri::AppHandle) {}

/// Applies [`unquote_exec`] to the handler entry. Called after every `register`
/// and `register_all`, both of which rewrite the file with the quotes back on.
#[tauri::command]
fn deep_link_fix_handler(app: tauri::AppHandle) {
	#[cfg(not(target_os = "linux"))]
	let _ = app;

	#[cfg(target_os = "linux")]
	{
		// Same name the plugin derives, so we edit the file it just wrote.
		let (Ok(bin), Ok(data)) = (tauri::utils::platform::current_exe(), app.path().data_dir())
		else {
			return;
		};
		let path = data.join("applications").join(format!(
			"{}-handler.desktop",
			bin.file_name().unwrap_or_default().to_string_lossy()
		));

		if let Ok(entry) = std::fs::read_to_string(&path) {
			let fixed = unquote_exec(&entry);
			if fixed != entry {
				let _ = std::fs::write(&path, fixed);
			}
		}
	}
}

/// Where the audio goes quiet, in seconds from the start of the file, over
/// `duration` seconds starting at `start`. The frontend slides a subtitle's cues
/// over this to find the delay that puts them back on the dialogue.
///
/// ffmpeg is mpv's own decoder shipped as a command, so it reads exactly what is
/// playing — including a half-downloaded mkv served over librqbit's http range
/// endpoint, which is why this takes the stream URL and not a path.
#[tauri::command]
async fn audio_silence(url: String, start: f64, duration: f64) -> Result<Vec<(f64, f64)>, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let out = std::process::Command::new("ffmpeg")
			.args(["-hide_banner", "-nostats", "-nostdin", "-v", "info"])
			// A stalled read (a piece that never arrives) must not hang the app.
			.args(["-rw_timeout", "15000000"])
			.args(["-ss", &start.to_string(), "-t", &duration.max(1.0).to_string()])
			.args(["-i", &url])
			// -30 dB / 0.3 s is roughly "a gap between lines" for film audio.
			.args(["-vn", "-af", "silencedetect=n=-30dB:d=0.3", "-f", "null", "-"])
			.output()
			.map_err(|e| format!("syncing needs ffmpeg on PATH, and it would not start: {e}"))?;

		// It reports on stderr, re-based to 0 by the -ss above, one edge per line:
		//   [silencedetect @ …] silence_start: 12.345
		//   [silencedetect @ …] silence_end: 14.5 | silence_duration: 2.155
		let log = String::from_utf8_lossy(&out.stderr);
		let mut spans: Vec<(f64, f64)> = Vec::new();
		let mut open: Option<f64> = None;
		for line in log.lines() {
			let value = |tag: &str| {
				line.split_once(tag)
					.and_then(|(_, rest)| rest.split('|').next())
					.and_then(|v| v.trim().parse::<f64>().ok())
			};
			if let Some(t) = value("silence_start:") {
				open = Some(t);
			} else if let Some(t) = value("silence_end:") {
				let from = open.take().unwrap_or(0.0);
				spans.push((start + from, start + t));
			}
		}
		// A file that fades out ends mid-silence and never prints the closing edge.
		if let Some(from) = open {
			spans.push((start + from, start + duration));
		}

		if spans.is_empty() && !out.status.success() {
			let tail: Vec<&str> = log.lines().rev().take(4).collect();
			return Err(format!("ffmpeg could not read the audio: {}", tail.join(" ")));
		}
		Ok(spans)
	})
	.await
	.map_err(|e| e.to_string())?
}

/// One frame from `url` at `at` seconds, JPEG, for the preview that follows the
/// cursor along the seek bar. Empty when there was no frame to be had.
///
/// Same ffmpeg, same reason as `audio_silence`: it reads exactly what mpv is
/// playing, half-downloaded mkv over librqbit's range endpoint included. The
/// frontend only asks for positions already on disk (see `haveAt`), so a hover
/// never puts a piece request in front of the film. `rw_timeout` is the backstop
/// for when it guesses wrong — a preview is never worth stalling on.
#[tauri::command]
async fn thumbnail(url: String, at: f64) -> Result<tauri::ipc::Response, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let out = std::process::Command::new("ffmpeg")
			.args(["-hide_banner", "-nostats", "-nostdin", "-v", "error"])
			.args(["-rw_timeout", "5000000"])
			// Before -i: seek by keyframe and start decoding there, rather than
			// reading the file from the top to reach one frame.
			.args(["-ss", &at.to_string()])
			.args(["-i", &url])
			.args(["-an", "-frames:v", "1"])
			// yuvj420p because mjpeg has no 10-bit: an HDR release encodes to
			// nothing at all without it.
			.args(["-vf", "scale=192:-2", "-pix_fmt", "yuvj420p", "-f", "mjpeg", "-"])
			.output()
			.map_err(|e| format!("previews need ffmpeg on PATH, and it would not start: {e}"))?;
		Ok(tauri::ipc::Response::new(out.stdout))
	})
	.await
	.map_err(|e| e.to_string())?
}

/// Where the engine keeps torrent data and its own state.
fn cache_dir(app: &tauri::AppHandle) -> PathBuf {
	app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir())
}

#[derive(serde::Serialize)]
struct DiskSpace {
	/// Bytes a normal process may still write.
	free: u64,
	/// Size of the whole filesystem, which the reserve is a fraction of.
	total: u64,
}

/// Free/total bytes on the filesystem holding the torrent cache. The frontend
/// turns this into a storage budget and deletes the oldest torrents once the
/// cache exceeds it (see the downloads store). Errors are not fatal: a frontend
/// that can't read the disk simply never evicts anything.
///
/// `path` is the storage folder from settings, which can be on another drive
/// than the default one; without it the app's own cache folder is measured.
#[tauri::command]
fn disk_space(app: tauri::AppHandle, path: Option<String>) -> Result<DiskSpace, String> {
	let dir = match path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
		Some(p) => PathBuf::from(p),
		None => cache_dir(&app).join("ventic-torrents"),
	};
	#[cfg(unix)]
	{
		use std::os::unix::ffi::OsStrExt;
		let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
		let mut raw = std::mem::MaybeUninit::<libc::statvfs>::uninit();
		if unsafe { libc::statvfs(path.as_ptr(), raw.as_mut_ptr()) } != 0 {
			return Err(format!("statvfs({}) failed", dir.display()));
		}
		let s = unsafe { raw.assume_init() };
		// f_frsize is the unit both block counts are in. f_bavail (not f_bfree)
		// is what an unprivileged process may use — the difference is the
		// filesystem's own root-only reserve.
		let unit = s.f_frsize as u64;
		Ok(DiskSpace { free: s.f_bavail as u64 * unit, total: s.f_blocks as u64 * unit })
	}
	#[cfg(not(unix))]
	{
		let _ = dir;
		Err("disk space is only implemented for unix targets".into())
	}
}

/// The librqbit HTTP API + streaming server listens here. The Nuxt frontend
/// talks to it directly (add torrents, poll stats) and points a plain <video>
/// element at `http://127.0.0.1:3030/torrents/{id}/stream/{file_idx}`.
const TORRENT_API_ADDR: &str = "127.0.0.1:3030";

/// Boot a librqbit session and expose its HTTP API (which includes the
/// range-capable streaming endpoint). Runs forever on the tokio runtime.
async fn run_torrent_server(
	download_dir: std::path::PathBuf,
	session_dir: std::path::PathBuf,
) -> anyhow::Result<()> {
	// librqbit's HTTP API only allows a fixed CORS allowlist by default
	// (ports 3031/1420 + tauri://localhost). Widen it so the Nuxt dev server
	// (any localhost port) and the packaged app can call the API from fetch().
	// On Android the webview serves the app from http://tauri.localhost, on
	// Windows from https://tauri.localhost.
	// The predicate reads this env var when the server is constructed below.
	std::env::set_var(
		"CORS_ALLOW_REGEXP",
		r"^(https?://localhost(:\d+)?|https?://127\.0\.0\.1(:\d+)?|tauri://localhost|https?://tauri\.localhost)$"
	);

	// Remember torrents across restarts, so a background download resumes where
	// it left off and the downloads page isn't empty on every launch. The folder
	// is ours: the defaults are shared with any real rqbit install on the machine.
	let opts = |with_dht: bool| SessionOptions {
		persistence: Some(SessionPersistenceConfig::Json { folder: Some(session_dir.clone()) }),
		fastresume: true,
		dht: with_dht.then(|| DhtSessionConfig {
			// Ask for a fresh port every launch. librqbit otherwise persists
			// whichever ephemeral port the OS handed it and re-binds that exact
			// port next time, which on Windows is a time bomb: Hyper-V and WSL
			// reserve blocks of the dynamic range and re-roll them at every
			// boot, so a port that worked yesterday can land inside a reserved
			// block today. Binding it then fails with WSAEACCES — "forbidden by
			// its access permissions", not the EADDRINUSE you'd expect — and it
			// never recovers on its own. Port 0 makes the OS pick something it
			// knows is free; only the port is re-rolled, the routing table below
			// still persists and that is the part worth keeping.
			port: Some(0),
			persistence: Some(DhtPersistenceConfig {
				config_filename: Some(session_dir.join("dht.json")),
				..Default::default()
			}),
			..Default::default()
		}),
		..Default::default()
	};

	let session = match Session::new_with_opts(download_dir.clone(), opts(true)).await {
		Ok(session) => session,
		Err(e) => {
			// A DHT that won't start must not take the rest of the engine with
			// it. The HTTP API below is what serves playback and the downloads
			// UI, and trackers alone still find peers for most torrents, so come
			// up degraded rather than leaving the app with no engine at all.
			eprintln!("[ventic] torrent session failed to start ({e:#}) — retrying without DHT");
			Session::new_with_opts(download_dir, opts(false)).await?
		}
	};
	let api = Api::new(session, None, None);

	let addr: std::net::SocketAddr = TORRENT_API_ADDR.parse()?;
	// On a dev hot-restart the previous process can still hold the port for a
	// moment. Binding once and giving up leaves the app running with no engine
	// ("Engine offline" and nothing plays), so retry briefly before failing.
	let mut listener = None;
	for attempt in 0..20 {
		match TcpListener::bind_tcp(addr, Default::default()) {
			Ok(l) => {
				listener = Some(l);
				break;
			}
			Err(e) => {
				if attempt == 19 {
					return Err(e.into());
				}
				eprintln!("[ventic] port {TORRENT_API_ADDR} busy, retrying… ({e})");
				tokio::time::sleep(Duration::from_millis(500)).await;
			}
		}
	}
	let listener = listener.expect("loop either binds or returns early");

	HttpApi::new(api, None)
		.make_http_api_and_run(listener, None)
		.await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	// librqbit needs a full-featured multi-threaded tokio runtime (DHT, uTP,
	// HTTP streaming). Build one and hand it to Tauri's async runtime so
	// `tauri::async_runtime::spawn` schedules onto it.
	let rt = tokio::runtime::Builder::new_multi_thread()
		.enable_all()
		.build()
		.expect("failed to build tokio runtime");
	tauri::async_runtime::set(rt.handle().clone());
	std::mem::forget(rt); // keep the runtime alive for the whole process

	player::init();

	let builder = tauri::Builder::default();

	// A `ventic://` link clicked while the app is already open must reach the
	// running copy, not start a second one — two processes would fight over the
	// engine's port 3030 and the second would come up with no engine at all.
	// This has to be the first plugin registered for the forwarding to work, and
	// the `deep-link` feature is what makes the second process's URL arrive as
	// an open-url event rather than as argv nobody reads.
	#[cfg(desktop)]
	let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
		use tauri::Manager;
		if let Some(window) = app.get_webview_window("main") {
			let _ = window.set_focus();
		}
	}));

	builder
		.plugin(tauri_plugin_deep_link::init())
		.manage(player::PlayerState::default())
		.invoke_handler(tauri::generate_handler![
			player::player_start,
			player::player_stop,
			player::player_ipc,
			player::player_props,
			player::player_set_geometry,
			player::player_pointer,
			player::player_status,
			audio_silence,
			thumbnail,
			deep_link_fix_handler,
			disk_space
		])
		.setup(|app| {
			// The installers write the scheme association (registry keys on
			// Windows, a .desktop MimeType on Linux), so a build that was never
			// installed — `tauri dev`, a bare .exe, an unregistered AppImage —
			// would not answer ventic:// links at all. Registering at startup
			// covers those. macOS reads it from the bundle's Info.plist and
			// returns UnsupportedPlatform here, which is not an error worth
			// failing the launch over.
			#[cfg(desktop)]
			{
				use tauri_plugin_deep_link::DeepLinkExt;
				// Deliberately not `register_all`. The config lists `stremio` as
				// well, but only so the plugin *accepts* such a URL when one
				// arrives — it drops any scheme not named there, whether the link
				// launched the app or was forwarded into the running copy.
				// Claiming the scheme from the desktop is the separate, opt-in
				// decision below, and `register_all` would take both every launch.
				if let Err(e) = app.deep_link().register("ventic") {
					eprintln!("[ventic] could not register the ventic:// scheme: {e}");
				}
				claim_stremio_if_free(app.handle());
				deep_link_fix_handler(app.handle().clone());
			}

			#[cfg(desktop)]
			{
				let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
				let menu = Menu::with_items(app, &[&quit_i])?;

				let _tray = TrayIconBuilder::new()
					.menu(&menu)
					.show_menu_on_left_click(true)
					.icon(app.default_window_icon().unwrap().clone())
					.on_menu_event(|app, event| match event.id.as_ref() {
						"quit" => {
							app.exit(0);
						}
						other => {
							println!("menu item {} not handled", other);
						}
					})
					.build(app)?;
			}

			// Where finished/partial torrent data lives on disk, and next to it
			// the engine's own state (which torrents exist, resume data).
			let cache_dir = cache_dir(app.handle());
			let download_dir = cache_dir.join("ventic-torrents");
			let session_dir = cache_dir.join("ventic-session");
			std::fs::create_dir_all(&download_dir).ok();
			std::fs::create_dir_all(&session_dir).ok();

			tauri::async_runtime::spawn(async move {
				if let Err(e) = run_torrent_server(download_dir, session_dir).await {
					eprintln!("[ventic] torrent server exited with error: {e:#}");
				}
			});

			Ok(())
		})
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_shell::init())
		.plugin(tauri_plugin_notification::init())
		.plugin(tauri_plugin_os::init())
		.plugin(tauri_plugin_fs::init())
		.plugin(tauri_plugin_store::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
	use super::unquote_exec;

	/// What the plugin writes, what xdg-open needs, and what must be left alone.
	#[test]
	fn exec_quotes() {
		let entry = "[Desktop Entry]\nExec=\"/opt/ventic/ventic\" %u\nMimeType=x-scheme-handler/ventic;\n";
		assert!(unquote_exec(entry).contains("Exec=/opt/ventic/ventic %u"));
		// Everything else survives, and a second pass changes nothing.
		assert!(unquote_exec(entry).contains("MimeType=x-scheme-handler/ventic;"));
		assert_eq!(unquote_exec(&unquote_exec(entry)), unquote_exec(entry));
		// A path with a space keeps its quotes — see unquote_exec.
		let spaced = "Exec=\"/home/a b/ventic\" %u\n";
		assert_eq!(unquote_exec(spaced), spaced);
	}
}
