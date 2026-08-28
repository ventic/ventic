// ----------------------------------------------------------------------------
// Embedded mpv player — macOS backend
//
// Same job as the X11 and Win32 backends and, from the page's side, the same
// player: mpv glued to a box in the document, driven over its JSON IPC socket.
// How the picture gets there is what differs. Neither of the other two tricks
// is available here — macOS embeds no other process's window, and mpv's Cocoa
// output takes no `--wid` — so mpv is not a child process at all. It is libmpv,
// in this process, rendering into an NSOpenGLView we own (player_render_mac.rs).
//
// Two things fall out of that, and everything else is unchanged:
//
//   - Control is still the IPC socket, not the C API. libmpv honours
//     `input-ipc-server` exactly as the binary does, so `player_socket.rs` and
//     every command and property the frontend already sends work untouched.
//     The C API is used for three things only: creating the handle with its
//     options, loading the file, and tearing it down.
//   - The surface goes *under* the webview rather than over it, so there are no
//     cutouts to punch and no clicks to forward — the page is simply in front.
//     `hasVideoOverlay()` in app/utils/htmlvideo.ts is what tells the frontend.
//
// mpv is not bundled: libmpv is linked, so the .app needs one installed
// (`brew install mpv`), which is also the only way it builds. See build.rs.
// ----------------------------------------------------------------------------

use std::ffi::CString;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use libmpv2::Mpv;
use objc2_foundation::MainThreadMarker;

use crate::player_render_mac::{self, Geometry};
use crate::player_socket;

#[derive(Default)]
struct Player {
	mpv: Option<Mpv>,
	ipc: Option<PathBuf>,
	log: Option<PathBuf>,
}

/// What the frontend polls to tell "playing" apart from "mpv gave up".
#[derive(serde::Serialize)]
pub struct PlayerStatus {
	running: bool,
	log_tail: Option<String>,
}

#[derive(Default)]
pub struct PlayerState(Mutex<Player>);

/// Nothing to prepare: no display connection, no windowing backend to force.
pub fn init() {}

/// Run `f` on the main thread and wait for its answer.
///
/// AppKit, the GL context and mpv's render context all belong to the main
/// thread. Which thread a command arrives on is Tauri's business — a synchronous
/// one runs on the main thread itself — so this checks before it hops: queueing
/// work behind the thread you are *already* on and then waiting for it is a
/// deadlock, and one that would only show up on the platform we cannot test.
///
/// Nothing passed here may touch `PlayerState`, whose lock the caller holds.
fn on_main<R: Send + 'static>(
	app: &tauri::AppHandle,
	f: impl FnOnce() -> R + Send + 'static,
) -> Result<R, String> {
	if MainThreadMarker::new().is_some() {
		return Ok(f());
	}
	let (tx, rx) = mpsc::sync_channel::<R>(1);
	app.run_on_main_thread(move || {
		let _ = tx.send(f());
	})
	.map_err(|e| format!("could not reach the main thread: {e}"))?;
	rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "the main thread never answered".to_string())
}

/// One mpv command with its arguments passed as an array rather than a string.
///
/// `Mpv::command` joins its arguments with spaces and hands the lot to mpv's
/// own parser, which then has opinions about quotes and backslashes — and the
/// argument here is a URL a source handed us.
fn command(mpv: &Mpv, argv: &[&str]) -> Result<(), String> {
	let owned: Vec<CString> = argv
		.iter()
		.map(|s| CString::new(*s).map_err(|_| "the stream URL contains a null byte".to_string()))
		.collect::<Result<_, _>>()?;
	let mut ptrs: Vec<*const std::os::raw::c_char> = owned.iter().map(|c| c.as_ptr()).collect();
	ptrs.push(std::ptr::null());
	let rc = unsafe { libmpv2_sys::mpv_command(mpv.ctx.as_ptr(), ptrs.as_mut_ptr()) };
	if rc < 0 {
		return Err(format!("mpv rejected {}: error {rc}", argv[0]));
	}
	Ok(())
}

/// Is mpv sitting idle — because the file played out, or never opened?
///
/// The other backends answer "is it still running" by looking at a process.
/// There is none here: the player is a library in this process and outlives any
/// one film, so the question becomes whether it still has a file open.
fn idle(ipc: &Path) -> bool {
	let names = [String::from("idle-active")];
	player_socket::properties(ipc, &names)
		.ok()
		.and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
		.and_then(|v| v.get("idle-active").and_then(serde_json::Value::as_bool))
		// A socket that didn't answer is a socket that was busy, not a player
		// that died — saying otherwise would end playback on a hiccup.
		.unwrap_or(false)
}

impl Player {
	/// Order matters: mpv's render context has to be freed before the handle it
	/// belongs to, and on the main thread.
	fn stop(&mut self, app: &tauri::AppHandle) {
		if self.mpv.is_some() {
			let _ = on_main(app, player_render_mac::uninstall);
		}
		drop(self.mpv.take());
		if let Some(ipc) = self.ipc.take() {
			let _ = std::fs::remove_file(ipc);
		}
		if let Some(log) = self.log.take() {
			let _ = std::fs::remove_file(log);
		}
	}
}

/// Start playback into a surface tracking the frontend's video box.
///
/// `x`/`y`/`width`/`height` are that box in **physical** pixels relative to the
/// webview viewport's top-left, and `view_w`/`view_h` the size of that viewport
/// — the pair is what lets the surface be placed by ratio instead of by a guess
/// at the display's backing scale.
#[tauri::command]
pub fn player_start(
	app: tauri::AppHandle,
	window: tauri::WebviewWindow,
	state: tauri::State<'_, PlayerState>,
	url: String,
	x: i32,
	y: i32,
	width: u32,
	height: u32,
	view_w: u32,
	view_h: u32,
) -> Result<(), String> {
	// A degenerate box means the webview hadn't laid out yet; the caller retries.
	if width < 16 || height < 16 {
		return Err(format!("player box not laid out yet ({width}x{height}px) — retrying"));
	}

	let ns_window = window.ns_window().map_err(|e| format!("no NSWindow: {e}"))? as isize;

	let mut player = state.0.lock().unwrap();
	player.stop(&app);

	// mpv writes its own diagnostics to the log so `player_status` can report
	// *why* it stopped rather than leaving the user staring at a black box.
	let (ipc, log) = player_socket::paths();

	let ipc_arg = ipc.display().to_string();
	let log_arg = log.display().to_string();
	let mpv = Mpv::with_initializer(move |init| {
		// Best effort throughout: a libmpv built without Lua has no `osc`
		// property at all, and one missing option is not worth refusing to play
		// over.
		let set = |k: &str, v: &str| {
			let _ = init.set_property(k, v);
		};
		set("input-ipc-server", &ipc_arg);
		set("log-file", &log_arg);
		set("config", "no"); // ignore the user's ~/.config/mpv for predictability
		set("terminal", "no");
		set("msg-level", "all=warn");
		set("title", "Ventic");
		set("audio-client-name", "Ventic");
		// The picture is behind the webview, so every key and every click lands
		// in the page — mpv is never the one being typed at, and its own OSC
		// would be drawn under the page's controls anyway.
		set("input-default-bindings", "no");
		set("input-media-keys", "no");
		set("input-cursor", "no");
		set("osc", "no");
		set("osd-level", "0");
		set("force-window", "no");
		set("hwdec", "videotoolbox-copy");
		// libmpv wakes the render callback ahead of the frame's presentation
		// time and blocks inside render() until it comes round. That wait is on
		// the main thread, which is also WebKit's, so the whole UI would stutter
		// in time with the film. Wake at the target time instead.
		set("video-timing-offset", "0");
		// The source is always a local librqbit URL, so mpv's youtube-dl hook
		// can only ever fail (it spawns yt-dlp three times and logs errors).
		set("ytdl", "no");
		// Torrent streams stall (a piece isn't in yet) and librqbit sometimes
		// drops the connection outright. Cache what we have and reconnect
		// instead of ending playback.
		set("cache", "yes");
		set("stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_delay_max=5");
		set("keep-open", "no");
		Ok(())
	})
	.map_err(|e| format!("libmpv would not start: {e:?}"))?;

	// Not a video output at all: mpv hands the frames to us instead of drawing
	// them, which is the only way the picture can be inside this window.
	mpv.set_property("vo", "libmpv").map_err(|e| format!("vo=libmpv refused: {e:?}"))?;

	let geometry = Geometry {
		x: f64::from(x),
		y: f64::from(y),
		width: f64::from(width),
		height: f64::from(height),
		view_w: f64::from(view_w),
		view_h: f64::from(view_h),
	};
	// As an address, because a raw pointer is not Send and this may have to cross
	// to the main thread. The handle outlives the hop: it is dropped further down
	// this function at the earliest, under the same lock.
	let ctx = mpv.ctx.as_ptr() as usize;
	on_main(&app, move || match std::ptr::NonNull::new(ctx as *mut libmpv2_sys::mpv_handle) {
		Some(ctx) => player_render_mac::install(ctx, ns_window, geometry),
		None => Err("libmpv handed back no handle".into()),
	})??;

	command(&mpv, &["loadfile", &url])?;

	player.mpv = Some(mpv);
	player.ipc = Some(ipc);
	player.log = Some(log);
	Ok(())
}

/// Stop playback and take the surface back out of the window.
#[tauri::command]
pub fn player_stop(app: tauri::AppHandle, state: tauri::State<'_, PlayerState>) {
	state.0.lock().unwrap().stop(&app);
}

#[tauri::command]
pub fn player_ipc(state: tauri::State<'_, PlayerState>, command: String) -> Result<String, String> {
	let path = state.0.lock().unwrap().ipc.clone().ok_or("player not running")?;
	player_socket::command(&path, &command)
}

#[tauri::command]
pub fn player_props(state: tauri::State<'_, PlayerState>, names: Vec<String>) -> Result<String, String> {
	let path = state.0.lock().unwrap().ipc.clone().ok_or("player not running")?;
	player_socket::properties(&path, &names)
}

/// Track the frontend's video box. No cutouts: the page is in front of the
/// picture here, so it needs no holes cut for it.
#[tauri::command]
pub fn player_set_geometry(
	app: tauri::AppHandle,
	x: i32,
	y: i32,
	width: u32,
	height: u32,
	view_w: u32,
	view_h: u32,
	visible: bool,
) {
	let geometry = Geometry {
		x: f64::from(x),
		y: f64::from(y),
		width: f64::from(width),
		height: f64::from(height),
		view_w: f64::from(view_w),
		view_h: f64::from(view_h),
	};
	let _ = on_main(&app, move || player_render_mac::resize_to(geometry, visible));
}

/// Nothing to do: mpv has no window here — we draw its frames into a view
/// *under* the webview — so the pointer over the picture is the page's own and
/// `cursor-none` on the player's root hides it.
#[tauri::command]
pub fn player_cursor() {}

/// The webview is in front of the picture, so it sees the pointer itself and
/// the controls un-hide from ordinary DOM events.
#[tauri::command]
pub fn player_pointer() -> Option<()> {
	None
}

/// Has mpv still got the file open? If not, hand back the tail of its log so
/// the frontend can show a real error instead of a silent black rectangle.
#[tauri::command]
pub fn player_status(state: tauri::State<'_, PlayerState>) -> PlayerStatus {
	let player = state.0.lock().unwrap();
	let running = match player.ipc.as_deref() {
		Some(ipc) => player.mpv.is_some() && !idle(ipc),
		None => false,
	};

	let log_tail = if running { None } else { player.log.as_deref().and_then(player_socket::log_tail) };
	PlayerStatus { running, log_tail }
}
