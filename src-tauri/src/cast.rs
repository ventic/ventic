//! Casting — playing what this device holds on another Ventic on the same network.
//!
//! What travels is a **URL**, not a torrent. The receiver plays it through the
//! same path a debrid link or a live channel takes (`?url=` in
//! `pages/watch.vue`), so playback, progress, subtitles and the library needed
//! no second implementation — and the film is not downloaded twice, which
//! matters most on the device most likely to be receiving: a TV box with 8 GB
//! of storage cannot hold a second copy of anything.
//!
//! Two servers, neither on by default, each started by the frontend one at a
//! time:
//!
//!   * the **receiver** (`cast_receive`) — one endpoint another device posts a
//!     play command to, guarded by the pairing code the receiving screen shows.
//!     Without it, anyone on the Wi-Fi could put anything on your television.
//!   * the **mirror** (`cast_share`) — a second librqbit HTTP API, **read only**
//!     and bound to the LAN, so the other device can pull the film over http
//!     range exactly as this one's own player does. The engine's real API stays
//!     on 127.0.0.1 where it has always been: it can add and delete torrents,
//!     and nothing outside this process has any business calling it.
//!
//! Both are LAN-only by construction. Nothing here traverses NAT, and there is
//! no server in the middle — the same reason there is no account (see the
//! library store).

use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::{Mutex, OnceLock};

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use librqbit::api::Api;
use librqbit::http_api::{HttpApi, HttpApiOptions};
use librqbit_dualstack_sockets::TcpListener;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// The read-only engine mirror another device streams the film from.
pub const MIRROR_PORT: u16 = 3231;

/// Where a play command is posted. Both of these are ours and both are new;
/// 3030 is the engine's own API and is not exposed to anything.
pub const RECEIVER_PORT: u16 = 3232;

/// The engine's API handle, so a second HTTP server can be put in front of the
/// same session. Set once, when the engine comes up — see `lib.rs`.
static ENGINE: OnceLock<Api> = OnceLock::new();

/// Shutdown switches, `Some` exactly while that server is running. Dropping the
/// sender is what stops it, so `take()` is the whole of "stop".
static MIRROR: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);
static RECEIVER: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

/// Hands the engine's API to the two commands below. Called from the torrent
/// server's own startup, which is the only thing that has one.
pub fn set_engine(api: Api) {
	let _ = ENGINE.set(api);
}

/// A play command, as it arrives and as the page receives it (minus the code).
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Play {
	/// Matched against this device's own, then blanked — the page never sees it.
	#[serde(default)]
	code: String,
	/// Always a URL: the mirror's stream, a debrid link, or a live channel.
	url: String,
	/// TMDB's identity for the title, so the receiver files progress under the
	/// same key its own library would have used. Empty for a bare magnet.
	#[serde(default)]
	kind: String,
	#[serde(default)]
	id: String,
	#[serde(default)]
	season: u32,
	#[serde(default)]
	episode: u32,
	/// Shown while the stream warms up, since the receiver may have no TMDB.
	#[serde(default)]
	title: String,
	/// Seconds to resume at — where the sending device had got to.
	#[serde(default)]
	position: f64,
}

/// What a device answers a probe with. `app` is what tells a Ventic apart from
/// whatever else on the network happens to answer on this port.
#[derive(Serialize)]
struct Identity {
	app: &'static str,
	name: String,
}

#[derive(Clone)]
struct Receiving {
	app: AppHandle,
	name: String,
	code: String,
}

/// This device's address on the network it would reach the world over.
///
/// A UDP `connect` sends no packet — it only asks the routing table which
/// interface one *would* leave by, which is the question neither the hostname
/// nor the interface list answers on a machine with a VPN, a docker bridge and
/// two NICs. The address is TEST-NET-1 and is meant to be unroutable; nothing
/// is ever sent to it.
///
/// ponytail: needs a default route, so a LAN with no gateway answers None. The
/// address field on the cast dialog is the fallback, and has to exist anyway.
fn local_ip() -> Option<IpAddr> {
	let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
	socket.connect("192.0.2.1:9").ok()?;
	socket.local_addr().ok().map(|addr| addr.ip())
}

/// This device's LAN address, for the receiving screen to show and the sending
/// one to work a subnet out of.
#[tauri::command]
pub fn cast_address() -> Option<String> {
	local_ip().map(|ip| ip.to_string())
}

/// Is the mirror serving? Read by Android's foreground service through the
/// engine, and by the settings screen.
#[tauri::command]
pub fn cast_sharing() -> bool {
	MIRROR.lock().is_ok_and(|guard| guard.is_some())
}

/// Start or stop the read-only engine mirror. Returns the base URL the other
/// device should be pointed at, or None once it is stopped.
///
/// Restarts rather than refusing when it is already up: the caller asking again
/// means the answer is wanted, not that something is wrong.
///
/// `async` for one reason, and it is not that anything here awaits: a dualstack
/// listener registers with tokio's reactor as it binds and *panics* without
/// one, and tauri runs a synchronous command on the main thread, where there is
/// no runtime. An async command is run on the async runtime, which is ours.
/// Binding out here rather than inside the task is what lets a port already in
/// use come back as an error the user can read.
#[tauri::command]
pub async fn cast_share(enable: bool) -> Result<Option<String>, String> {
	if let Ok(mut guard) = MIRROR.lock() {
		guard.take();
	}
	if !enable {
		return Ok(None);
	}

	let api = ENGINE.get().ok_or("the torrent engine hasn't started yet")?.clone();
	let ip = local_ip().ok_or("this device has no address on a network")?;
	let addr = SocketAddr::from(([0, 0, 0, 0], MIRROR_PORT));
	// Bound here rather than inside the task so a port already taken is an error
	// the user sees, not a line in a log nobody reads.
	let listener = TcpListener::bind_tcp(addr, Default::default())
		.map_err(|e| format!("could not open port {MIRROR_PORT}: {e}"))?;

	let (tx, rx) = oneshot::channel();
	tauri::async_runtime::spawn(async move {
		let server = HttpApi::new(api, Some(HttpApiOptions {
			// The whole point: this one can be read from, never written to.
			read_only: true,
			..Default::default()
		}))
		.make_http_api_and_run(listener, None);

		tokio::select! {
			result = server => {
				if let Err(e) = result {
					eprintln!("[ventic] cast mirror stopped: {e:#}");
				}
			}
			// The sender was dropped — `cast_share(false)`, or the app going away.
			_ = rx => {}
		}
	});

	if let Ok(mut guard) = MIRROR.lock() {
		*guard = Some(tx);
	}
	Ok(Some(format!("http://{ip}:{MIRROR_PORT}")))
}

/// Start or stop answering play commands. `name` is what the sending device
/// lists this one as; `code` is the pairing code shown on this screen.
#[tauri::command]
pub fn cast_receive(app: AppHandle, enable: bool, name: String, code: String) -> Result<(), String> {
	if let Ok(mut guard) = RECEIVER.lock() {
		guard.take();
	}
	if !enable {
		return Ok(());
	}
	// A blank code would pair with anything that forgot to send one.
	if code.is_empty() {
		return Err("a pairing code is required".into());
	}

	let state = Receiving { app, name, code };
	let addr = SocketAddr::from(([0, 0, 0, 0], RECEIVER_PORT));
	let listener = std::net::TcpListener::bind(addr)
		.map_err(|e| format!("could not open port {RECEIVER_PORT}: {e}"))?;
	listener
		.set_nonblocking(true)
		.map_err(|e| format!("could not open port {RECEIVER_PORT}: {e}"))?;

	let (tx, rx) = oneshot::channel();
	tauri::async_runtime::spawn(async move {
		let listener = match tokio::net::TcpListener::from_std(listener) {
			Ok(listener) => listener,
			Err(e) => {
				eprintln!("[ventic] cast receiver could not start: {e:#}");
				return;
			}
		};
		let router = Router::new()
			.route("/ventic", get(identity))
			.route("/ventic/play", post(play))
			.with_state(state);

		tokio::select! {
			result = axum::serve(listener, router) => {
				if let Err(e) = result {
					eprintln!("[ventic] cast receiver stopped: {e:#}");
				}
			}
			_ = rx => {}
		}
	});

	if let Ok(mut guard) = RECEIVER.lock() {
		*guard = Some(tx);
	}
	Ok(())
}

/// Answers a probe. Deliberately says nothing but the name: this is reachable
/// by anything on the network, and the code is what gates the part that acts.
async fn identity(State(state): State<Receiving>) -> Json<Identity> {
	Json(Identity { app: "ventic", name: state.name })
}

async fn play(State(state): State<Receiving>, Json(mut command): Json<Play>) -> StatusCode {
	// A four-digit code read off a television and typed on a phone, over a
	// network the sender is already on: what matters is that a wrong one is
	// refused, not how long refusing it took.
	if command.code != state.code {
		return StatusCode::FORBIDDEN;
	}
	command.code = String::new();

	match state.app.emit("cast://play", command) {
		Ok(()) => StatusCode::OK,
		Err(e) => {
			eprintln!("[ventic] cast command could not reach the page: {e:#}");
			StatusCode::INTERNAL_SERVER_ERROR
		}
	}
}
