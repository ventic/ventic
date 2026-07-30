// Stand-in for the embedded mpv player on macOS and Android.
//
// The real backends parent an mpv process into a child window of the app window
// — X11 on Linux (player.rs), an HWND on Windows (player_windows.rs). Neither
// ports to what is left:
//   - macOS: mpv's `--wid` takes an NSView, but a bundled mpv has to be signed
//     and notarised with the app, and the window has to be handed over on the
//     main thread.
//   - Android: no arbitrary child processes at all. It plays through ExoPlayer
//     instead, which needs no Rust — the frontend talks to it over the same
//     JavascriptInterface bridge the activity already had (`Player.kt`).
//
// The commands still have to compile and be registered, because the frontend
// invokes them unconditionally on the path that expects a native window. They
// fail with a message the player's error card can show, rather than a black
// rectangle — though on Android nothing asks, since `hasExoPlayer()` picks the
// shim before it gets that far.

const UNSUPPORTED: &str = "The video player is available on Linux and Windows right now. \
This build can browse and download, but playback needs the native mpv backend.";

/// Nothing to guard: no display connection is opened on these targets.
#[derive(Default)]
pub struct PlayerState;

#[derive(serde::Serialize)]
pub struct PlayerStatus {
	running: bool,
	log_tail: Option<String>,
}

pub fn init() {}

// Tauri resolves command arguments by name out of the request payload and
// ignores anything it wasn't asked for, so these can drop the parameters the
// frontend still sends.

#[tauri::command]
pub fn player_start() -> Result<(), String> {
	Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn player_stop() {}

#[tauri::command]
pub fn player_ipc() -> Result<String, String> {
	Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn player_props() -> Result<String, String> {
	Err(UNSUPPORTED.into())
}

#[tauri::command]
pub fn player_set_geometry() {}

/// No native surface, so nothing is ever covering the pointer.
#[tauri::command]
pub fn player_pointer() -> Option<()> {
	None
}

#[tauri::command]
pub fn player_status() -> PlayerStatus {
	PlayerStatus { running: false, log_tail: Some(UNSUPPORTED.into()) }
}
