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
// window, which is X11 on Linux and an HWND on Windows. macOS embeds no other
// process's window, so there mpv is a library in this one, rendering into a
// view of ours; Android has no child processes at all and the same commands
// compile as stubs that report why.
#[cfg_attr(target_os = "linux", path = "player.rs")]
#[cfg_attr(target_os = "windows", path = "player_windows.rs")]
#[cfg_attr(target_os = "macos", path = "player_macos.rs")]
#[cfg_attr(not(any(target_os = "linux", target_os = "windows", target_os = "macos")), path = "player_unsupported.rs")]
mod player;

/// mpv's IPC socket, shared by the two backends that have one.
#[cfg(any(target_os = "linux", target_os = "macos"))]
mod player_socket;

/// The NSOpenGLView libmpv renders into, which is macOS's answer to embedding.
#[cfg(target_os = "macos")]
mod player_render_mac;

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

/// Seconds of audio behind one reading of `audio_envelope`. The frontend lines
/// subtitle cues up against those readings and has to bucket them the same way,
/// so this is spelled out on both sides (`BIN` in app/utils/subtitles.ts).
const ENVELOPE_BIN: f64 = 0.2;
/// Sample rate the envelope is measured at. Nothing above 3 kHz survives the
/// low-pass below, so 8 kHz is already more than Nyquist asks for and keeps the
/// decode cheap.
const ENVELOPE_HZ: f64 = 8000.0;
/// Quieter than this is silence as far as the fit is concerned; it also stands in
/// for the `-inf` ffmpeg prints for a digitally empty frame, which is not a
/// number the frontend could average.
const ENVELOPE_FLOOR: f32 = -91.0;

/// What to spawn for ffmpeg — the seek previews and the subtitle auto-sync both
/// shell out to it, and neither has any other way to read the audio or a frame.
///
/// Three answers, in order:
///
/// - **The bundled one.** Windows has no ffmpeg and no package manager to get
///   one from, so the build downloads it beside mpv.exe and Tauri ships it as a
///   resource (`scripts/build/mpv.ts`). Same lookup `mpv_binary` does.
/// - **Homebrew's or MacPorts'.** A macOS .app launched from Finder inherits
///   none of the shell's environment: it gets `/usr/bin:/bin:/usr/sbin:/sbin`
///   and nothing more, so a perfectly good `brew install ffmpeg` is invisible
///   and both features fail on the one desktop that needs Homebrew to build in
///   the first place. Same prefixes `build.rs` hands the linker, for the reason.
/// - **PATH**, which is the whole of it on Linux and the fallback everywhere.
///
/// Resolved once: the answer cannot change while the app runs, and the previews
/// ask for one on every hover.
fn ffmpeg(app: &tauri::AppHandle) -> &'static std::ffi::OsStr {
	static FOUND: std::sync::OnceLock<std::ffi::OsString> = std::sync::OnceLock::new();
	FOUND.get_or_init(|| {
		// Resolves to nothing on the platforms that declare no such resource, so
		// this needs no cfg of its own.
		if let Some(bundled) = app
			.path()
			.resolve("mpv/ffmpeg.exe", tauri::path::BaseDirectory::Resource)
			.ok()
			.filter(|p| p.is_file())
		{
			return bundled.into();
		}

		#[cfg(target_os = "macos")]
		if let Some(brewed) =
			["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/local/bin/ffmpeg"]
				.into_iter()
				.find(|p| std::path::Path::new(p).exists())
		{
			return brewed.into();
		}

		"ffmpeg".into()
	})
}

/// `ffmpeg`, ready to spawn. Go through this rather than `Command::new` — the
/// flag it sets is not optional on Windows.
///
/// ffmpeg.exe is a console binary, and a release build has no console to lend
/// it: `windows_subsystem = "windows"` means the app never allocated one, so
/// Windows gives every child a brand new one instead. The seek bar decodes a
/// preview per position hovered, and each one flashed up its own terminal —
/// which is also why hiding the bar "fixed" it. `tauri dev` hides the bug just
/// as well, because there the app is launched from a shell and the console the
/// child inherits is the one already on screen. mpv is spawned with the same
/// flag for the same reason (`player_windows.rs`).
#[cfg(target_os = "windows")]
fn ffmpeg_command(exe: &std::ffi::OsStr) -> std::process::Command {
	use std::os::windows::process::CommandExt;
	let mut cmd = std::process::Command::new(exe);
	cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
	cmd
}

/// Nothing to add: Windows is the only one of the four that invents a console
/// for a child process that hasn't got one.
#[cfg(not(target_os = "windows"))]
fn ffmpeg_command(exe: &std::ffi::OsStr) -> std::process::Command {
	std::process::Command::new(exe)
}

/// Speech-band loudness over `duration` seconds from `start`, one RMS reading in
/// dB per `ENVELOPE_BIN`. The frontend slides a subtitle's cues along this and
/// keeps the shift that correlates best, which is what puts them back on the
/// dialogue.
///
/// Not `silencedetect`: a fixed dB gate says "loud" for the score and the swords
/// as readily as for a voice, and on a film that is most of the runtime — which
/// leaves a fit with nothing to lock onto. A continuous envelope of the band
/// speech actually occupies keeps the shape of the dialogue instead of throwing
/// it away at a threshold.
///
/// ffmpeg is mpv's own decoder shipped as a command, so it reads exactly what is
/// playing — including a half-downloaded mkv served over librqbit's http range
/// endpoint, which is why this takes the stream URL and not a path.
#[tauri::command]
async fn audio_envelope(
	app: tauri::AppHandle,
	url: String,
	start: f64,
	duration: f64,
) -> Result<Vec<f32>, String> {
	let exe = ffmpeg(&app);
	tauri::async_runtime::spawn_blocking(move || {
		// A 5.1 mix puts the dialogue in the centre channel and the score around
		// it, so taking that one channel is worth about twice the confidence of
		// a downmix. Stereo has no centre — and `pan` answers that with silence
		// rather than an error, so the retry is driven by the readings, not by
		// an exit code.
		let levels = envelope_pass(exe, &url, start, duration, "pan=mono|c0=FC")?;
		if levels.iter().any(|v| *v > ENVELOPE_FLOOR) {
			return Ok(levels);
		}
		envelope_pass(exe, &url, start, duration, "aformat=channel_layouts=mono")
	})
	.await
	.map_err(|e| e.to_string())?
}

fn envelope_pass(
	exe: &std::ffi::OsStr,
	url: &str,
	start: f64,
	duration: f64,
	pan: &str,
) -> Result<Vec<f32>, String> {
	// astats resets per block and ametadata prints the one figure we want, so
	// the whole envelope comes back as plain text on stdout.
	let filter = format!(
		"{pan},highpass=f=300,lowpass=f=3000,aresample={hz},asetnsamples={n},\
		 astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
		hz = ENVELOPE_HZ as u64,
		n = (ENVELOPE_HZ * ENVELOPE_BIN) as u64,
	);

	let out = ffmpeg_command(exe)
		.args(["-hide_banner", "-nostats", "-nostdin", "-v", "error"])
		// A stalled read (a piece that never arrives) must not hang the app.
		.args(["-rw_timeout", "15000000"])
		.args(["-ss", &start.to_string(), "-t", &duration.max(1.0).to_string()])
		.args(["-i", url])
		.args(["-vn", "-af", &filter, "-f", "null", "-"])
		.output()
		.map_err(|e| format!("syncing needs ffmpeg, and {exe:?} would not start: {e}"))?;

	let levels: Vec<f32> = String::from_utf8_lossy(&out.stdout)
		.lines()
		.filter_map(|l| l.split_once("RMS_level="))
		// "-inf" parses in Rust, and an infinity would poison every average the
		// frontend takes, so the floor stands in for it.
		.map(|(_, v)| v.trim().parse::<f32>().unwrap_or(ENVELOPE_FLOOR))
		.map(|v| if v.is_finite() { v } else { ENVELOPE_FLOOR })
		.collect();

	if levels.is_empty() {
		let log = String::from_utf8_lossy(&out.stderr);
		let tail: Vec<&str> = log.lines().rev().take(4).collect();
		return Err(format!("ffmpeg could not read the audio: {}", tail.join(" ")));
	}
	Ok(levels)
}

/// One frame from `url` at `at` seconds, JPEG, for the preview that follows the
/// cursor along the seek bar. Empty when there was no frame to be had.
///
/// Same ffmpeg, same reason as `audio_envelope`: it reads exactly what mpv is
/// playing, half-downloaded mkv over librqbit's range endpoint included. The
/// frontend only asks for positions already on disk (see `haveAt`), so a hover
/// never puts a piece request in front of the film. `rw_timeout` is the backstop
/// for when it guesses wrong — a preview is never worth stalling on.
#[tauri::command]
async fn thumbnail(app: tauri::AppHandle, url: String, at: f64) -> Result<tauri::ipc::Response, String> {
	let exe = ffmpeg(&app);
	tauri::async_runtime::spawn_blocking(move || {
		let out = ffmpeg_command(exe)
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
			.map_err(|e| format!("previews need ffmpeg, and {exe:?} would not start: {e}"))?;
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

/// librqbit's own filesystem storage with its one 32-bit call routed around.
///
/// Every chunk is written with `pwritev`, whose offset argument is `off_t` —
/// **32 bits wide on armv7 Android**, which is what a cheap TV box runs.
/// librqbit narrows the u64 file offset into it with `try_into`, so the first
/// chunk landing past 2 GiB *into a file* fails the conversion and the download
/// dies with `error writing to file 0 (…)` — every retry lands in the same
/// place. Nothing to do with the drive: FAT32's own ceiling is 4 GiB (see
/// `maxFile` in MainActivity) and internal storage hits this identically.
///
/// The fix is to not have that method: `TorrentStorage::pwrite_all_vectored`'s
/// default issues the two halves as separate `pwrite_all`s, which is std's
/// `write_all_at` and compiles to `pwrite64` on every target. Left unconditional
/// rather than gated on the pointer width — one extra syscall on the minority of
/// chunks that arrive split is nothing beside hashing the piece, and a single
/// path means the desktop build exercises the one Android runs.
struct LargeFileStorage(Box<dyn librqbit::storage::TorrentStorage>);

impl librqbit::storage::TorrentStorage for LargeFileStorage {
	fn init(
		&mut self,
		shared: &librqbit::ManagedTorrentShared,
		metadata: &librqbit::TorrentMetadata,
	) -> anyhow::Result<()> {
		self.0.init(shared, metadata)
	}

	fn pread_exact(&self, file_id: usize, offset: u64, buf: &mut [u8]) -> anyhow::Result<()> {
		self.0.pread_exact(file_id, offset, buf)
	}

	fn pwrite_all(&self, file_id: usize, offset: u64, buf: &[u8]) -> anyhow::Result<()> {
		self.0.pwrite_all(file_id, offset, buf)
	}

	fn remove_file(&self, file_id: usize, filename: &std::path::Path) -> anyhow::Result<()> {
		self.0.remove_file(file_id, filename)
	}

	fn remove_directory_if_empty(&self, path: &std::path::Path) -> anyhow::Result<()> {
		self.0.remove_directory_if_empty(path)
	}

	fn ensure_file_length(&self, file_id: usize, length: u64) -> anyhow::Result<()> {
		self.0.ensure_file_length(file_id, length)
	}

	fn take(&self) -> anyhow::Result<Box<dyn librqbit::storage::TorrentStorage>> {
		Ok(Box::new(Self(self.0.take()?)))
	}
}

/// Note the `Storage` type: this hands back an already-boxed storage so it *is*
/// a `BoxStorageFactory`, rather than being put in one by `StorageFactoryExt::
/// boxed()`. That is not tidiness. `boxed()`'s private wrapper answers
/// `is_type_id` with `self.sf.type_id()` — the wrapped factory's own concrete
/// id, never the override below — and session persistence refuses any factory
/// that doesn't report itself as `FilesystemStorageFactory`. Through `boxed()`
/// the engine turns down every add with "storages other than
/// FilesystemStorageFactory are not supported", which is a 400 on the very
/// first magnet.
#[derive(Clone, Copy, Default)]
struct LargeFileStorageFactory(librqbit::storage::filesystem::FilesystemStorageFactory);

impl librqbit::storage::StorageFactory for LargeFileStorageFactory {
	type Storage = Box<dyn librqbit::storage::TorrentStorage>;

	fn create(
		&self,
		shared: &librqbit::ManagedTorrentShared,
		metadata: &librqbit::TorrentMetadata,
	) -> anyhow::Result<Self::Storage> {
		Ok(Box::new(LargeFileStorage(Box::new(self.0.create(shared, metadata)?))))
	}

	/// Answer as the storage we wrap, or persistence writes no resume file and
	/// every torrent is re-hashed from scratch on the next launch.
	fn is_type_id(&self, type_id: std::any::TypeId) -> bool {
		self.0.is_type_id(type_id)
	}

	fn clone_box(&self) -> librqbit::storage::BoxStorageFactory {
		Box::new(*self)
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
		// Films are routinely bigger than 2 GiB and a TV box is 32-bit. Boxed
		// here rather than through `.boxed()` — see LargeFileStorageFactory.
		default_storage_factory: Some(Box::new(LargeFileStorageFactory::default())),
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
			audio_envelope,
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
