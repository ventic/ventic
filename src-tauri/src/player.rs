// ----------------------------------------------------------------------------
// Embedded mpv player — X11 backend
//
// We run a normal mpv process but (a) parent its video into a child X11 window
// we create inside the app window (`--wid`), positioned/sized to track a DOM
// element in the frontend (the player "box"), and (b) drive it entirely over
// mpv's JSON IPC socket. The frontend measures its box with getBoundingClientRect
// and pushes the physical-pixel geometry via `player_set_geometry`, so the native
// video can sit inline in the page or expand to fill the window (fullscreen).
// mpv brings ffmpeg's decoders, so it plays everything librqbit can stream
// (HEVC/x265, E-AC-3/DDP, partially-downloaded mkv …). The IPC control layer is
// fully cross-platform and lives in player_socket.rs, shared with the macOS
// backend; only the X11 child-window embedding here is Linux-specific (Windows
// uses a child HWND — player_windows.rs — while macOS cannot embed at all and
// runs mpv in its own window, and Android has no child processes to run).
// ----------------------------------------------------------------------------

use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};

use crate::player_socket;

// ----------------------------------------------------------------------------
// Cutouts (X Shape extension)
//
// The native surface always paints above the webview, so DOM controls can never
// be composited on top of the video. Shaping gets the same result the other way
// round: cut the control-bar rectangles *out* of mpv's window and the page
// underneath shows through the holes — rendering and input both, since a
// window's input region follows its bounding shape. The video window itself
// never changes size for the UI, so nothing rescales when a bar appears.
//
// x11-dl doesn't wrap the Shape extension, so its one entry point is bound by
// hand out of libXext.
// ----------------------------------------------------------------------------
const SHAPE_BOUNDING: libc::c_int = 0;
const SHAPE_SET: libc::c_int = 0;
const SHAPE_SUBTRACT: libc::c_int = 3;
const SHAPE_UNSORTED: libc::c_int = 0;

#[repr(C)]
#[derive(Clone, Copy)]
struct XRectangle {
	x: libc::c_short,
	y: libc::c_short,
	width: libc::c_ushort,
	height: libc::c_ushort,
}

type ShapeRectsFn = unsafe extern "C" fn(
	*mut x11_dl::xlib::Display,
	x11_dl::xlib::Window,
	libc::c_int,
	libc::c_int,
	libc::c_int,
	*const XRectangle,
	libc::c_int,
	libc::c_int,
	libc::c_int,
);

/// A rectangle of the video window the frontend wants punched out, in physical
/// pixels relative to the video box's top-left.
#[derive(serde::Deserialize, Clone, Copy)]
pub struct Cutout {
	x: i32,
	y: i32,
	width: u32,
	height: u32,
}

fn shape_fn() -> Option<ShapeRectsFn> {
	static SHAPE: std::sync::OnceLock<Option<usize>> = std::sync::OnceLock::new();
	let addr = SHAPE.get_or_init(|| unsafe {
		let lib = libc::dlopen(c"libXext.so.6".as_ptr(), libc::RTLD_LAZY);
		if lib.is_null() {
			return None;
		}
		let sym = libc::dlsym(lib, c"XShapeCombineRectangles".as_ptr());
		if sym.is_null() { None } else { Some(sym as usize) }
	});
	addr.map(|a| unsafe { std::mem::transmute::<usize, ShapeRectsFn>(a) })
}

/// The X11 child window mpv renders into, kept alive for the player's lifetime
/// (closing the display connection would destroy the server-side window).
struct Embed {
	xlib: x11_dl::xlib::Xlib,
	display: *mut x11_dl::xlib::Display,
	window: x11_dl::xlib::Window,
}
// The display connection is only ever touched under `PlayerState`'s mutex, and
// we call XInitThreads() at startup, so serialised cross-thread use is sound.
unsafe impl Send for Embed {}

impl Embed {
	fn move_resize(&self, x: i32, y: i32, w: u32, h: u32) {
		unsafe {
			(self.xlib.XMoveResizeWindow)(self.display, self.window, x, y, w.max(1), h.max(1));
			(self.xlib.XFlush)(self.display);
		}
	}

	/// Map/unmap the video window. Unmapping is how we hide the native surface
	/// when its DOM box scrolls out of view — otherwise it would keep painting
	/// over whatever the webview draws in that region.
	fn set_visible(&self, visible: bool) {
		unsafe {
			if visible {
				(self.xlib.XMapWindow)(self.display, self.window);
			} else {
				(self.xlib.XUnmapWindow)(self.display, self.window);
			}
			(self.xlib.XFlush)(self.display);
		}
	}

	/// Reset the window to a plain rectangle, then subtract each cutout from it.
	/// Re-applied on every geometry change: a shape is stored in window
	/// coordinates and does not grow when the window is resized.
	fn set_shape(&self, w: u32, h: u32, cutouts: &[Cutout]) {
		let Some(shape) = shape_fn() else {
			return; // no libXext: controls simply stay behind the video
		};
		let clip = |v: i32| v.clamp(0, i32::from(i16::MAX)) as libc::c_short;
		let full = XRectangle { x: 0, y: 0, width: w.max(1) as libc::c_ushort, height: h.max(1) as libc::c_ushort };
		let holes: Vec<XRectangle> = cutouts
			.iter()
			.filter(|c| c.width > 0 && c.height > 0)
			.map(|c| XRectangle {
				x: clip(c.x),
				y: clip(c.y),
				width: c.width.min(u32::from(u16::MAX)) as libc::c_ushort,
				height: c.height.min(u32::from(u16::MAX)) as libc::c_ushort,
			})
			.collect();
		unsafe {
			shape(self.display, self.window, SHAPE_BOUNDING, 0, 0, &full, 1, SHAPE_SET, SHAPE_UNSORTED);
			if !holes.is_empty() {
				shape(
					self.display,
					self.window,
					SHAPE_BOUNDING,
					0,
					0,
					holes.as_ptr(),
					holes.len() as libc::c_int,
					SHAPE_SUBTRACT,
					SHAPE_UNSORTED,
				);
			}
			(self.xlib.XFlush)(self.display);
		}
	}

	fn destroy(self) {
		unsafe {
			(self.xlib.XDestroyWindow)(self.display, self.window);
			(self.xlib.XFlush)(self.display);
			(self.xlib.XCloseDisplay)(self.display);
		}
	}
}

#[derive(Default)]
struct Player {
	mpv: Option<Child>,
	ipc: Option<PathBuf>,
	embed: Option<Embed>,
	log: Option<PathBuf>,
}

/// What the frontend polls to tell "playing" apart from "mpv died silently".
#[derive(serde::Serialize)]
pub struct PlayerStatus {
	/// False once the mpv process has exited (or was never started).
	running: bool,
	/// Tail of mpv's own log, so a failure can be reported instead of a black box.
	log_tail: Option<String>,
}

#[derive(Default)]
pub struct PlayerState(Mutex<Player>);

impl Player {
	fn stop(&mut self) {
		if let Some(mut mpv) = self.mpv.take() {
			let _ = mpv.kill();
			let _ = mpv.wait();
		}
		if let Some(embed) = self.embed.take() {
			embed.destroy();
		}
		if let Some(ipc) = self.ipc.take() {
			let _ = std::fs::remove_file(ipc);
		}
		if let Some(log) = self.log.take() {
			let _ = std::fs::remove_file(log);
		}
	}
}

/// Prepare the process for X11. Must run before GTK is initialised (i.e. before
/// `tauri::Builder::run`) and before any other X call.
pub fn init() {
	// mpv can only embed into an X11 window, so the app window has to be one:
	// under a Wayland session GTK would otherwise give us a wl_surface with no
	// XID and playback would fail with "App window is not X11". Forcing the
	// backend here rather than in the dev script means packaged builds get it
	// too. XWayland is part of every Wayland desktop that can run this app.
	//
	// Unconditional on purpose: Wayland sessions (Hyprland, GNOME, KDE) export
	// GDK_BACKEND=wayland themselves, so honouring an inherited value means
	// honouring the one value that cannot work here.
	std::env::set_var("GDK_BACKEND", "x11");

	// Make Xlib safe to call from multiple threads: we touch one display
	// connection from both command handlers and the resize event, serialised by
	// `PlayerState`'s mutex.
	if let Ok(xlib) = x11_dl::xlib::Xlib::open() {
		unsafe { (xlib.XInitThreads)() };
	}
}

/// Resolve the native X11 window id of the app window (needs GDK_BACKEND=x11).
fn x11_window_id(window: &tauri::WebviewWindow) -> Result<x11_dl::xlib::Window, String> {
	let raw = window
		.window_handle()
		.map_err(|e| format!("no window handle: {e}"))?
		.as_raw();
	match raw {
		RawWindowHandle::Xlib(h) => Ok(h.window as x11_dl::xlib::Window),
		RawWindowHandle::Xcb(h) => Ok(u32::from(h.window) as x11_dl::xlib::Window),
		_ => Err("App window is not X11 — launch under GDK_BACKEND=x11 (XWayland).".into()),
	}
}

/// Which mpv to run. A bundled copy (shipped as a Tauri resource, which is how
/// the Windows build gets one) wins over whatever is on PATH; otherwise we fall
/// back to the system install, which is the normal case on Linux.
fn mpv_binary(app: &tauri::AppHandle) -> std::ffi::OsString {
	use tauri::Manager;
	app.path()
		.resolve("mpv", tauri::path::BaseDirectory::Resource)
		.ok()
		.filter(|p| p.is_file())
		.map(Into::into)
		.unwrap_or_else(|| "mpv".into())
}

/// Start the embedded player: create the child video window and launch mpv.
///
/// `x`/`y`/`width`/`height` are the initial geometry of the video box in
/// **physical** pixels, relative to the app window's client-area top-left
/// (i.e. the webview viewport origin). The frontend keeps this in sync via
/// `player_set_geometry` as its DOM box moves/resizes.
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
) -> Result<(), String> {
	// A degenerate box means the webview hadn't laid out yet. Embedding mpv into
	// a 1x1 window makes it fail to bring up its video output and exit silently
	// (a black box with a frozen 0:00 timer), so refuse and let the caller retry
	// once the DOM box has a real size.
	if width < 16 || height < 16 {
		return Err(format!(
			"player box not laid out yet ({width}x{height}px) — retrying"
		));
	}

	let parent = x11_window_id(&window)?;

	let mut player = state.0.lock().unwrap();
	player.stop();

	// Create the X11 child window mpv will render into, positioned to match the
	// frontend's video box.
	let xlib = x11_dl::xlib::Xlib::open().map_err(|e| format!("libX11: {e}"))?;
	let display = unsafe { (xlib.XOpenDisplay)(std::ptr::null()) };
	if display.is_null() {
		return Err("XOpenDisplay failed (no X11/XWayland display available)".into());
	}
	let child = unsafe {
		let w = (xlib.XCreateSimpleWindow)(
			display, parent, x, y, width.max(1), height.max(1), 0, 0, 0,
		);
		(xlib.XMapWindow)(display, w);
		(xlib.XFlush)(display);
		w
	};
	let embed = Embed { xlib, display, window: child };

	// mpv writes its own diagnostics to the log so `player_status` can report
	// *why* it died rather than leaving the user staring at a black box.
	let (ipc, log) = player_socket::paths();

	let spawn = std::process::Command::new(mpv_binary(&app))
		.arg(format!("--wid={child}"))
		.arg("--force-window=yes")
		.arg("--no-config") // ignore user's ~/.config/mpv for predictability
		.arg("--no-osc") // we draw our own controls
		.arg("--osd-level=0")
		.arg("--no-input-default-bindings")
		// Never let the embedded video window swallow key presses — all shortcuts
		// are handled by the webview. (Cursor input stays on: the frontend reads
		// mpv's `mouse-pos` to un-hide the controls in fullscreen.)
		.arg("--input-vo-keyboard=no")
		.arg("--hwdec=auto-safe")
		// The source is always a local librqbit URL, so mpv's youtube-dl hook can
		// only ever fail (it spawns yt-dlp three times and logs errors).
		.arg("--no-ytdl")
		// Torrent streams stall (a piece isn't in yet) and librqbit sometimes
		// drops the connection outright. Cache what we have and reconnect
		// instead of ending playback.
		.arg("--cache=yes")
		.arg("--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_delay_max=5")
		.arg("--keep-open=no")
		.arg("--no-terminal")
		.arg("--msg-level=all=warn")
		.arg(format!("--input-ipc-server={}", ipc.display()))
		.arg(format!("--log-file={}", log.display()))
		// In a Wayland session mpv defaults to its own Wayland window and
		// ignores --wid (X11-only), so it has to be pushed onto the X11
		// (XWayland) output to embed into our child window.
		//
		// Empty, not removed. `wl_display_connect(NULL)` falls back to the
		// literal socket name "wayland-0" when WAYLAND_DISPLAY is unset — which
		// is exactly what GNOME and KDE call theirs, so *unsetting* the variable
		// on those sessions still lands mpv on Wayland and pops the film into
		// its own window. (Hyprland names its socket wayland-1, which is why
		// this never showed up here.) An empty value defeats both the fallback
		// and mpv's own "is there a compositor" check, which only looks for the
		// variable being present.
		.env("WAYLAND_DISPLAY", "")
		// An AppImage puts its own libraries — the build box's, so usually older
		// than the machine's — in front of everything on LD_LIBRARY_PATH. mpv is
		// the *system's*, and inheriting that kills it on the first symbol its
		// own dependencies have and the bundle's copies don't.
		.env_remove("LD_LIBRARY_PATH")
		.arg(&url)
		.spawn();

	match spawn {
		Ok(mpv) => {
			player.mpv = Some(mpv);
			player.ipc = Some(ipc);
			player.embed = Some(embed);
			player.log = Some(log);
			Ok(())
		}
		Err(e) => {
			embed.destroy();
			Err(format!("failed to launch mpv (is it installed?): {e}"))
		}
	}
}

/// Stop the embedded player and tear down its window.
#[tauri::command]
pub fn player_stop(state: tauri::State<'_, PlayerState>) {
	state.0.lock().unwrap().stop();
}

/// Relay one JSON command to mpv's IPC socket and return its response line.
/// `command` is a full mpv IPC object, e.g. `{"command":["cycle","pause"]}`.
#[tauri::command]
pub fn player_ipc(state: tauri::State<'_, PlayerState>, command: String) -> Result<String, String> {
	let path = state.0.lock().unwrap().ipc.clone().ok_or("player not running")?;
	player_socket::command(&path, &command)
}

/// Read several mpv properties over a single socket connection.
#[tauri::command]
pub fn player_props(state: tauri::State<'_, PlayerState>, names: Vec<String>) -> Result<String, String> {
	let path = state.0.lock().unwrap().ipc.clone().ok_or("player not running")?;
	player_socket::properties(&path, &names)
}

/// Move/resize the embedded video window to track the frontend's DOM box, and
/// punch the frontend's overlay controls out of it.
/// Geometry is in physical pixels relative to the webview viewport origin;
/// cutouts are relative to the box's own top-left.
/// `visible` is false when the box is scrolled out of view, so the native
/// surface stops painting over the rest of the UI.
#[tauri::command]
pub fn player_set_geometry(
	state: tauri::State<'_, PlayerState>,
	x: i32,
	y: i32,
	width: u32,
	height: u32,
	visible: bool,
	cutouts: Vec<Cutout>,
) {
	let player = state.0.lock().unwrap();
	if let Some(embed) = player.embed.as_ref() {
		if visible {
			embed.move_resize(x, y, width, height);
			embed.set_shape(width, height, &cutouts);
		}
		embed.set_visible(visible);
	}
}

/// Where the mouse is — a question this backend does not have to answer.
///
/// The webview never sees a pointer over the native surface, so the frontend has
/// to ask someone where it is. Under X11 mpv's own `mouse-pos` property stays
/// correct for the whole film and is already read alongside the playback
/// properties, so answering `null` here keeps that to one round trip. The
/// Windows backend implements it for real, because an embedded mpv there does
/// not report the cursor dependably and the controls could not un-hide.
#[tauri::command]
pub fn player_pointer() -> Option<()> {
	None
}

/// Is mpv still alive? If not, hand back the tail of its log so the frontend can
/// show a real error instead of a silent black rectangle.
#[tauri::command]
pub fn player_status(state: tauri::State<'_, PlayerState>) -> PlayerStatus {
	let mut player = state.0.lock().unwrap();
	let running = match player.mpv.as_mut() {
		// try_wait returns Ok(None) while the child is still running.
		Some(child) => matches!(child.try_wait(), Ok(None)),
		None => false,
	};

	let log_tail = if running { None } else { player.log.as_deref().and_then(player_socket::log_tail) };
	PlayerStatus { running, log_tail }
}
