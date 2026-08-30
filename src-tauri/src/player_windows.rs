// ----------------------------------------------------------------------------
// Embedded mpv player — Win32 backend
//
// Same shape as the X11 backend (player.rs): run a real mpv process, parent its
// video into a child window we own inside the app window (`--wid`), keep that
// window glued to a DOM box the frontend measures, and drive playback over
// mpv's JSON IPC. Four things are genuinely different from X11:
//
//   - the child window is an HWND, and an HWND belongs to the thread that
//     created it. A window whose thread never pumps messages hangs everything
//     attached to it — and creating a child under another thread's parent
//     attaches the two input queues — so ours gets its own pump (`Embed::spawn`).
//   - the control cutouts are a window region instead of an X Shape mask.
//     A region clips painting *and* hit testing, and it clips descendants too,
//     so mpv's own window inside ours is cut the same way.
//   - the IPC socket is a named pipe, which has no read timeout the way a
//     socket does — hence `with_deadline`.
//   - mpv creates its embedded window **disabled** (`EnableWindow(w32->window,
//     0)`, unconditional for every `--wid` embed), so unlike on X11 it never
//     receives a click, a wheel notch or a key press: the system routes them to
//     the nearest enabled ancestor, which is our container. mpv's own
//     MBTN_LEFT/WHEEL bindings are therefore dead here, and `wnd_proc` stands in
//     for them — including handing the keyboard focus back to the webview,
//     which is where every shortcut is handled.
//
// Windows ships no mpv, so the build downloads one and Tauri carries it beside
// the exe. See scripts/build/mpv.ts and `mpv_binary`.
// ----------------------------------------------------------------------------

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Child;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::Emitter;
use windows_sys::Win32::Foundation::{ERROR_PIPE_BUSY, HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
	CombineRgn, CreateRectRgn, DeleteObject, GetStockObject, ScreenToClient, SetWindowRgn,
	BLACK_BRUSH, RGN_DIFF,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Pipes::WaitNamedPipeW;
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
	CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW,
	GetWindow, IsChild, LoadCursorW, PostMessageW, PostQuitMessage, RegisterClassExW, SetWindowPos,
	ShowWindow, TranslateMessage, WindowFromPoint, GW_CHILD, HWND_TOP, IDC_ARROW, MSG,
	SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE,
	SW_SHOWNOACTIVATE, WM_CLOSE, WM_DESTROY, WM_LBUTTONDOWN, WM_MOUSEACTIVATE, WM_MOUSEWHEEL,
	WM_SETFOCUS, WNDCLASSEXW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_NOPARENTNOTIFY,
	WS_VISIBLE,
};

/// A rectangle of the video window the frontend wants punched out, in physical
/// pixels relative to the video box's top-left.
#[derive(serde::Deserialize, Clone, Copy)]
pub struct Cutout {
	x: i32,
	y: i32,
	width: u32,
	height: u32,
}

/// Null-terminated UTF-16: every Win32 call here takes a wide string.
fn wide(s: &str) -> Vec<u16> {
	s.encode_utf16().chain(std::iter::once(0)).collect()
}

// ----------------------------------------------------------------------------
// The container window
// ----------------------------------------------------------------------------

/// The app window, so the video window's thread can reach the page. Set on the
/// first `player_start` and good for the life of the process.
static PAGE: OnceLock<tauri::WebviewWindow> = OnceLock::new();

/// Set while the click that is bringing the app back to the front is still on
/// its way in. See `WM_LBUTTONDOWN`.
static REACTIVATING: AtomicBool = AtomicBool::new(false);

/// Report a mouse event on the picture to the frontend, which owns what the
/// controls do about it. mpv answers these itself on X11; here its window is
/// disabled and never sees them (see the header).
fn notify(event: &str, payload: i32) {
	if let Some(page) = PAGE.get() {
		// `emit` posts to the event loop from any thread, so the pump below is
		// never left waiting on the main thread — which would deadlock it.
		let _ = page.emit(event, payload);
	}
}

/// Put the keyboard focus back in the page.
///
/// Every shortcut is handled in the webview, so a focus that has drifted off it
/// is a player that ignores space and the arrow keys until something with a
/// cutout is clicked. Two separate things put it there, and a plain
/// `SetFocus` fixes neither reliably: this window can take the focus when the
/// app is re-activated with the pointer over the picture, and WebView2 can hold
/// on to its *window's* focus while the document inside it quietly loses its
/// own — which is what a trip out to another app and back leaves behind.
///
/// Focusing the webview covers both, because it is WebView2's `MoveFocus`
/// rather than a window call, and it is dispatched to the main thread, which is
/// the only one that may talk to the controller.
fn focus_page() {
	if let Some(page) = PAGE.get() {
		let webview: &tauri::Webview = page.as_ref();
		let _ = webview.set_focus();
	}
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
	match msg {
		// Focus lands here when the app is re-activated with the pointer over
		// the picture. Give it straight back, or the page stops seeing keys.
		WM_SETFOCUS => {
			focus_page();
			0
		}
		// Sent ahead of the click, and only while the app is in the background.
		// HIWORD(lParam) is the mouse message that is about to follow.
		WM_MOUSEACTIVATE => {
			if ((lp >> 16) & 0xffff) as u32 == WM_LBUTTONDOWN {
				REACTIVATING.store(true, Ordering::Relaxed);
			}
			DefWindowProcW(hwnd, msg, wp, lp)
		}
		WM_LBUTTONDOWN => {
			// Unconditional, not just on the way back from another app: the
			// document can be left without the focus by anything that took it
			// out of the window, and clicking the picture is how a mouse user
			// says "I am driving this again".
			focus_page();
			// A click that brings the window forward only does that — it is not
			// also a play/pause. Every desktop player treats the first click
			// after another app as activation, and pausing a film because
			// someone came back from Discord is the wrong answer.
			if !REACTIVATING.swap(false, Ordering::Relaxed) {
				notify("player:click", 0);
			}
			0
		}
		// One notch, signed. Windows delivers this to whichever window the
		// pointer is over as long as "scroll inactive windows" is on, which it
		// is by default.
		WM_MOUSEWHEEL => {
			let delta = ((wp >> 16) & 0xffff) as u16 as i16;
			notify("player:wheel", if delta > 0 { 1 } else { -1 });
			0
		}
		WM_CLOSE => {
			DestroyWindow(hwnd);
			0
		}
		// Ends the pump below, which is how the thread is joined.
		WM_DESTROY => {
			PostQuitMessage(0);
			0
		}
		_ => DefWindowProcW(hwnd, msg, wp, lp),
	}
}

/// Register the window class once per process. A black background means the box
/// is black rather than uninitialised in the moment before mpv paints into it.
fn register_class() -> Result<(), String> {
	static CLASS: OnceLock<bool> = OnceLock::new();
	let registered = *CLASS.get_or_init(|| unsafe {
		let name = wide(CLASS_NAME);
		let class = WNDCLASSEXW {
			cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
			style: 0,
			lpfnWndProc: Some(wnd_proc),
			cbClsExtra: 0,
			cbWndExtra: 0,
			hInstance: GetModuleHandleW(ptr::null()),
			hIcon: ptr::null_mut(),
			hCursor: LoadCursorW(ptr::null_mut(), IDC_ARROW),
			hbrBackground: GetStockObject(BLACK_BRUSH),
			lpszMenuName: ptr::null(),
			lpszClassName: name.as_ptr(),
			hIconSm: ptr::null_mut(),
		};
		RegisterClassExW(&class) != 0
	});
	if registered {
		Ok(())
	} else {
		Err("could not register the video window class".into())
	}
}

const CLASS_NAME: &str = "VenticVideo";

/// The child window mpv renders into. It lives on its own thread, which owns it
/// and pumps its messages until the window is destroyed.
struct Embed {
	/// The HWND as a plain integer, so the state it lives in stays `Send`.
	hwnd: isize,
}

impl Embed {
	/// Create the video window on a thread of its own and start its message
	/// pump. Everything after this can be called from any thread: the window
	/// operations below go to that pump.
	fn spawn(parent: isize, x: i32, y: i32, width: u32, height: u32) -> Result<Embed, String> {
		let (tx, rx) = mpsc::channel::<Result<isize, String>>();
		std::thread::Builder::new()
			.name("ventic-video".into())
			.spawn(move || {
				let created = unsafe { create_window(parent as HWND, x, y, width, height) };
				let ok = created.is_ok();
				let _ = tx.send(created);
				if !ok {
					return;
				}
				unsafe {
					let mut msg: MSG = std::mem::zeroed();
					while GetMessageW(&mut msg, ptr::null_mut(), 0, 0) > 0 {
						TranslateMessage(&msg);
						DispatchMessageW(&msg);
					}
				}
			})
			.map_err(|e| format!("could not start the video window thread: {e}"))?;

		// Waiting here is only safe because creating the window sends the parent
		// thread nothing — see WS_EX_NOPARENTNOTIFY in `create_window`.
		match rx.recv() {
			Ok(Ok(hwnd)) => Ok(Embed { hwnd }),
			Ok(Err(e)) => Err(e),
			Err(_) => Err("the video window thread died before creating a window".into()),
		}
	}

	fn hwnd(&self) -> HWND {
		self.hwnd as HWND
	}

	fn move_resize(&self, x: i32, y: i32, w: u32, h: u32) {
		let (w, h) = (w.max(1) as i32, h.max(1) as i32);
		unsafe {
			// HWND_TOP every time, not just at creation: the webview is a sibling
			// and it does not stay put — anything that raises it would leave the
			// video playing behind an opaque page.
			SetWindowPos(self.hwnd(), HWND_TOP, x, y, w, h, SWP_NOACTIVATE);
			// mpv sizes its window to the parent when it creates it; keeping it
			// filled afterwards is our job. It is our only direct child, and it
			// belongs to mpv's thread — SWP_ASYNCWINDOWPOS posts the request
			// rather than waiting on a process that may be busy decoding.
			let video = GetWindow(self.hwnd(), GW_CHILD);
			if !video.is_null() {
				SetWindowPos(
					video,
					ptr::null_mut(),
					0,
					0,
					w,
					h,
					SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
				);
			}
		}
	}

	/// Show/hide the video window. Hiding is how we get the native surface out
	/// of the way when its DOM box scrolls off screen — otherwise it would keep
	/// painting over whatever the webview draws in that region.
	fn set_visible(&self, visible: bool) {
		unsafe {
			ShowWindow(self.hwnd(), if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
		}
	}

	/// Cut each overlay rectangle out of the window. The holes let the page
	/// underneath show through — clicks included, since a window region bounds
	/// hit testing as well as painting. Re-applied on every geometry change: a
	/// region is in window coordinates and does not grow when the window does.
	fn set_shape(&self, w: u32, h: u32, cutouts: &[Cutout]) {
		unsafe {
			// No overlays: back to a plain rectangle, and no region to keep.
			if cutouts.is_empty() {
				SetWindowRgn(self.hwnd(), ptr::null_mut(), 1);
				return;
			}
			let region = CreateRectRgn(0, 0, w.max(1) as i32, h.max(1) as i32);
			for c in cutouts.iter().filter(|c| c.width > 0 && c.height > 0) {
				let hole =
					CreateRectRgn(c.x, c.y, c.x + c.width as i32, c.y + c.height as i32);
				CombineRgn(region, region, hole, RGN_DIFF);
				DeleteObject(hole);
			}
			// The system owns a region it accepts; one it rejects is still ours.
			if SetWindowRgn(self.hwnd(), region, 1) == 0 {
				DeleteObject(region);
			}
		}
	}

	/// Where the cursor is relative to this window, and whether it is over the
	/// picture at all.
	///
	/// Nothing here asks mpv, and nothing here needs a message: the cursor is
	/// system-wide state on Win32, so it can be read no matter which window the
	/// pointer messages went to.
	fn pointer(&self) -> Option<(i32, i32, bool)> {
		unsafe {
			let mut pt = POINT { x: 0, y: 0 };
			if GetCursorPos(&mut pt) == 0 {
				return None; // no cursor to read (locked session, secure desktop)
			}
			// WindowFromPoint honours window regions, so a point inside one of
			// the control cutouts comes back as the webview rather than as us —
			// which saves testing the point against the cutouts by hand, and
			// stays right even while a bar is mid-slide.
			let hit = WindowFromPoint(pt);
			let over = hit == self.hwnd() || IsChild(self.hwnd(), hit) != 0;
			ScreenToClient(self.hwnd(), &mut pt);
			Some((pt.x, pt.y, over))
		}
	}

	/// Tear the window down. Its thread ends with it (WM_DESTROY posts the quit
	/// message), and we deliberately don't wait for that: a thread pumping
	/// messages can be sent one by the window manager at any moment, and a
	/// caller blocked on `join` would not be answering.
	fn destroy(self) {
		unsafe { PostMessageW(self.hwnd(), WM_CLOSE, 0, 0) };
	}
}

unsafe fn create_window(
	parent: HWND,
	x: i32,
	y: i32,
	width: u32,
	height: u32,
) -> Result<isize, String> {
	register_class()?;
	// WS_CLIPSIBLINGS keeps the webview from painting over us, WS_CLIPCHILDREN
	// keeps us from painting over mpv.
	//
	// WS_EX_NOPARENTNOTIFY is the load-bearing one: without it, creating and
	// destroying this window *sends* WM_PARENTNOTIFY to the thread that owns the
	// app window — which is the same thread the command asking for the window is
	// usually running on. It would wait for itself.
	let hwnd = CreateWindowExW(
		WS_EX_NOPARENTNOTIFY,
		wide(CLASS_NAME).as_ptr(),
		ptr::null(),
		WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
		x,
		y,
		width.max(1) as i32,
		height.max(1) as i32,
		parent,
		ptr::null_mut(),
		GetModuleHandleW(ptr::null()),
		ptr::null(),
	);
	if hwnd.is_null() {
		return Err(format!("could not create the video window: {}", std::io::Error::last_os_error()));
	}
	// A new child does not land in front of the webview on its own — measured,
	// not assumed: without this the video plays behind the page.
	SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
	Ok(hwnd as isize)
}

// ----------------------------------------------------------------------------
// mpv's IPC pipe
// ----------------------------------------------------------------------------

/// Run one blocking round trip and give up after `timeout`.
///
/// A named pipe has no read timeout, so a request mpv never answers would wedge
/// the thread it runs on — and the frontend polls nine properties five times a
/// second. Doing the I/O on a thread we can walk away from bounds the damage to
/// one abandoned thread, which unblocks by itself once mpv exits and the pipe
/// breaks.
fn with_deadline<T: Send + 'static>(
	timeout: Duration,
	job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
	let (tx, rx) = mpsc::sync_channel(1);
	std::thread::spawn(move || {
		let _ = tx.send(job());
	});
	rx.recv_timeout(timeout).unwrap_or_else(|_| Err("mpv did not answer in time".into()))
}

/// Open mpv's IPC pipe. mpv keeps one free instance and only creates the next
/// once a client has taken it, so a request landing in that gap is told the
/// pipe is busy rather than missing — wait for a free instance instead of
/// failing the call.
fn connect(path: &str) -> Result<File, String> {
	let deadline = Instant::now() + Duration::from_millis(500);
	loop {
		match OpenOptions::new().read(true).write(true).open(path) {
			Ok(pipe) => return Ok(pipe),
			Err(e)
				if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32)
					&& Instant::now() < deadline =>
			{
				unsafe { WaitNamedPipeW(wide(path).as_ptr(), 100) };
			}
			Err(e) => return Err(format!("mpv not ready: {e}")),
		}
	}
}

// ----------------------------------------------------------------------------
// Commands
// ----------------------------------------------------------------------------

#[derive(Default)]
struct Player {
	mpv: Option<Child>,
	pipe: Option<String>,
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
		// The pipe is mpv's own; it goes when the process does.
		self.pipe = None;
		if let Some(log) = self.log.take() {
			let _ = std::fs::remove_file(log);
		}
	}
}

/// Nothing to prepare: no display connection and no toolkit backend to force.
pub fn init() {}

/// The app window's HWND, which the video window hangs off. Its client area is
/// exactly the webview's viewport, so the frontend's coordinates carry over
/// untranslated.
fn parent_window(window: &tauri::WebviewWindow) -> Result<isize, String> {
	let raw = window
		.window_handle()
		.map_err(|e| format!("no window handle: {e}"))?
		.as_raw();
	match raw {
		RawWindowHandle::Win32(h) => Ok(h.hwnd.get()),
		_ => Err("the app window is not a Win32 window".into()),
	}
}

/// Which mpv to run. Windows has none of its own, so the build downloads one and
/// Tauri ships it as a resource; PATH is only a fallback for a machine that
/// happens to have its own install.
fn mpv_binary(app: &tauri::AppHandle) -> std::ffi::OsString {
	use tauri::Manager;
	app.path()
		.resolve("mpv/mpv.exe", tauri::path::BaseDirectory::Resource)
		.ok()
		.filter(|p| p.is_file())
		.map(Into::into)
		.unwrap_or_else(|| "mpv.exe".into())
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
		return Err(format!("player box not laid out yet ({width}x{height}px) — retrying"));
	}

	let parent = parent_window(&window)?;

	// The video window's thread has no other way to reach the page.
	let _ = PAGE.set(window.clone());

	let mut player = state.0.lock().unwrap();
	player.stop();

	let embed = Embed::spawn(parent, x, y, width, height)?;

	let pipe = format!(r"\\.\pipe\ventic-mpv-{}", std::process::id());
	// mpv writes its own diagnostics here so `player_status` can report *why* it
	// died rather than leaving the user staring at a black box.
	let log = std::env::temp_dir().join(format!("ventic-mpv-{}.log", std::process::id()));
	let _ = std::fs::remove_file(&log);

	let spawn = std::process::Command::new(mpv_binary(&app))
		.arg(format!("--wid={}", embed.hwnd))
		.arg("--force-window=yes")
		.arg("--no-config") // ignore any user mpv config for predictability
		.arg("--no-osc") // we draw our own controls
		.arg("--osd-level=0")
		.arg("--no-input-default-bindings")
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
		.arg(format!("--input-ipc-server={pipe}"))
		.arg(format!("--log-file={}", log.display()))
		// mpv.exe is a GUI binary and would not open one anyway, but a console
		// flashing up on every play is not worth risking.
		.creation_flags(CREATE_NO_WINDOW)
		.arg(&url)
		.spawn();

	match spawn {
		Ok(mpv) => {
			player.mpv = Some(mpv);
			player.pipe = Some(pipe);
			player.embed = Some(embed);
			player.log = Some(log);
			Ok(())
		}
		Err(e) => {
			embed.destroy();
			Err(format!("failed to launch mpv: {e} — mpv.exe should sit in the app's mpv folder"))
		}
	}
}

/// Stop the embedded player and tear down its window.
#[tauri::command]
pub fn player_stop(state: tauri::State<'_, PlayerState>) {
	state.0.lock().unwrap().stop();
}

/// Relay one JSON command to mpv's IPC pipe and return its response line.
/// `command` is a full mpv IPC object, e.g. `{"command":["cycle","pause"]}`.
#[tauri::command]
pub fn player_ipc(state: tauri::State<'_, PlayerState>, command: String) -> Result<String, String> {
	let path = state.0.lock().unwrap().pipe.clone().ok_or("player not running")?;
	// Most commands answer in microseconds, but `sub-add` downloads the subtitle
	// file over http before replying, so the window has to cover a slow server.
	with_deadline(Duration::from_secs(5), move || {
		let mut pipe = connect(&path)?;
		let mut line = command.trim().to_string();
		line.push('\n');
		pipe.write_all(line.as_bytes()).map_err(|e| e.to_string())?;

		// Command responses carry an "error" field and no "event" field; async
		// event lines carry "event" (and some, like end-file, even contain
		// "reason":"error"). Skip events and return the first real response.
		for line in BufReader::new(pipe).lines() {
			let line = line.map_err(|e| e.to_string())?;
			if !line.contains("\"event\"") && line.contains("\"error\"") {
				return Ok(line);
			}
		}
		Err("no response from mpv".into())
	})
}

/// Read several mpv properties over a single pipe connection.
///
/// The frontend polls half a dozen of these a few times a second, and a
/// connect/write/read round trip *each* is the difference between a smooth
/// progress bar and a stuttering one. Requests are pipelined and matched back up
/// by `request_id`; a property that fails comes back as null.
#[tauri::command]
pub fn player_props(
	state: tauri::State<'_, PlayerState>,
	names: Vec<String>,
) -> Result<String, String> {
	let path = state.0.lock().unwrap().pipe.clone().ok_or("player not running")?;
	with_deadline(Duration::from_secs(2), move || {
		let mut pipe = connect(&path)?;

		let mut req = String::new();
		for (i, name) in names.iter().enumerate() {
			req.push_str(
				&serde_json::json!({ "command": ["get_property", name], "request_id": i })
					.to_string(),
			);
			req.push('\n');
		}
		pipe.write_all(req.as_bytes()).map_err(|e| e.to_string())?;

		let mut out = serde_json::Map::new();
		for line in BufReader::new(pipe).lines() {
			let Ok(line) = line else { break };
			let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
			// Async event lines carry no request_id and are not answers to anything.
			let Some(id) = msg.get("request_id").and_then(|v| v.as_u64()) else { continue };
			let Some(name) = names.get(id as usize) else { continue };
			let ok = msg.get("error").and_then(|e| e.as_str()) == Some("success");
			let value = if ok {
				msg.get("data").cloned().unwrap_or(serde_json::Value::Null)
			} else {
				serde_json::Value::Null
			};
			out.insert(name.clone(), value);
			if out.len() == names.len() {
				break;
			}
		}
		Ok(serde_json::Value::Object(out).to_string())
	})
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

/// Where the mouse is, in physical pixels relative to the video window.
#[derive(serde::Serialize)]
pub struct Pointer {
	x: i32,
	y: i32,
	/// The cursor is on the picture — not on a control cutout, not on another
	/// window in front of ours, not outside the app.
	over: bool,
}

/// Nothing to do here, and that is the whole difference between the two embeds:
/// Win32 asks whether the pointer is over the client area before hiding it, not
/// whether the window holds the keyboard focus, so mpv's own `cursor-autohide`
/// works in a child window and answers this for us. X11 asks about focus, which
/// an embedded window never has — see `Embed::set_cursor` in player.rs.
#[tauri::command]
pub fn player_cursor() {}

/// Poll the cursor, since the webview never sees one that is over the native
/// surface and so cannot tell that the mouse moved there.
///
/// mpv answers the same question with its `mouse-pos` property, and that is
/// what the X11 backend reads, but an embedded mpv here does not keep it up to
/// date: the controls hid themselves and no amount of moving the mouse over the
/// picture brought them back, and leaving for a second monitor and returning
/// made it permanent. The cursor is system-wide state on Win32, so ask the
/// system — that answers whether or not mpv ever saw the pointer.
#[tauri::command]
pub fn player_pointer(state: tauri::State<'_, PlayerState>) -> Option<Pointer> {
	let player = state.0.lock().unwrap();
	let (x, y, over) = player.embed.as_ref()?.pointer()?;
	Some(Pointer { x, y, over })
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

	let log_tail = if running {
		None
	} else {
		player.log.as_ref().and_then(|p| std::fs::read_to_string(p).ok()).map(|s| {
			// mpv tags every line with its level — "[ 2.06][e][stream] Failed to
			// open …". Match on that rather than on the word "error", which also
			// occurs in the build flags mpv prints in its header (-Wno-error=…)
			// and would push the real failure out of the excerpt.
			let lines: Vec<&str> =
				s.lines().filter(|l| l.contains("][e]") || l.contains("][fatal]")).collect();
			let tail = if lines.is_empty() {
				s.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>()
			} else {
				lines
			};
			tail.join("\n").chars().take(1200).collect()
		})
	};

	PlayerStatus { running, log_tail }
}
