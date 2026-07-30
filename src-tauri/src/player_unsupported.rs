// Stand-in for the mpv player on the targets that can't run one: Android, and
// iOS if it is ever built.
//
// Every other backend runs a real mpv process — parented into a child window of
// the app window on Linux (player.rs) and Windows (player_windows.rs), in a
// window of its own on macOS (player_macos.rs). Android has no arbitrary child
// processes at all, so it plays through ExoPlayer instead, which needs no Rust:
// the frontend talks to it over the same JavascriptInterface bridge the
// activity already had (`Player.kt`).
//
// The commands still have to compile and be registered, because the frontend
// invokes them unconditionally on the path that expects a native player. They
// fail with a message the player's error card can show, rather than a black
// rectangle — though on Android nothing asks, since `hasExoPlayer()` picks the
// shim before it gets that far.

const UNSUPPORTED: &str = "There is no mpv on this platform. \
This build can browse and download, but playback needs the native player.";

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
