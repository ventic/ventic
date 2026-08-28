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

/// A running server's two ends: the switch that stops it, and the word back
/// that it has.
///
/// The second half is not ceremony. Dropping `stop` only *signals* the task —
/// the socket it is listening on is closed when that task next runs and drops
/// the future holding it, which is some time after this thread has carried on.
/// Both of these live on a fixed port and are stopped and started again in the
/// ordinary course of things: the receiver every time its name or its code
/// changes, the mirror on the cast after a cast that ended. A bind onto a
/// socket still in LISTEN fails — SO_REUSEADDR forgives a port in TIME_WAIT and
/// nothing else — so the stop is awaited rather than assumed, and a restart is
/// a restart rather than a coin toss that answers `Address already in use` when
/// it loses.
struct Shutdown {
	stop: oneshot::Sender<()>,
	done: oneshot::Receiver<()>
}

/// Shutdown switches, `Some` exactly while that server is running.
static MIRROR: Mutex<Option<Shutdown>> = Mutex::new(None);
static RECEIVER: Mutex<Option<Shutdown>> = Mutex::new(None);

/// Stop whichever server that slot holds, and wait for its port to come back.
///
/// The lock is taken and let go inside the first statement: a std mutex must not
/// be held across an await, and there is nothing to hold it for once the handle
/// is out.
async fn stop_server(slot: &Mutex<Option<Shutdown>>) {
	let running = slot.lock().ok().and_then(|mut guard| guard.take());
	if let Some(Shutdown { stop, done }) = running {
		drop(stop);
		// Err means the task is already gone, which is the same good news.
		let _ = done.await;
	}
}

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

/// A stop command. Carries the code and nothing else — there is only one thing
/// this device can be doing on the sender's behalf.
#[derive(Deserialize)]
pub struct Stop {
	#[serde(default)]
	code: String,
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
/// Asked for twice, it answers twice with the same URL and leaves the running
/// server alone. There is nothing a restart would change — one server, one
/// port, in front of the one session — and there is something it would break:
/// the connection the other device is streaming through. Casting a second film
/// while the first is still playing is exactly when this is asked again, and so
/// is a cast refused for a mistyped code and tried once more.
///
/// `async` first of all because a dualstack listener registers with tokio's
/// reactor as it binds and *panics* without one, and tauri runs a synchronous
/// command on the main thread, where there is no runtime. An async command is
/// run on the async runtime, which is ours. Binding out here rather than inside
/// the task is what lets a port already in use come back as an error the user
/// can read — and waiting for the last server to let go of that port is the
/// other thing only an async command can do (see `Shutdown`).
#[tauri::command]
pub async fn cast_share(enable: bool) -> Result<Option<String>, String> {
	if !enable {
		stop_server(&MIRROR).await;
		return Ok(None);
	}

	let ip = local_ip().ok_or("this device has no address on a network")?;
	if cast_sharing() {
		return Ok(Some(format!("http://{ip}:{MIRROR_PORT}")));
	}

	let api = ENGINE.get().ok_or("the torrent engine hasn't started yet")?.clone();
	let addr = SocketAddr::from(([0, 0, 0, 0], MIRROR_PORT));
	// Bound here rather than inside the task so a port already taken is an error
	// the user sees, not a line in a log nobody reads.
	let listener = TcpListener::bind_tcp(addr, Default::default())
		.map_err(|e| format!("could not open port {MIRROR_PORT}: {e}"))?;

	let (tx, rx) = oneshot::channel();
	let (done_tx, done_rx) = oneshot::channel();
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
		// The select's future is gone by here, and with it the socket. Only now
		// is the port somebody else's to take — see `Shutdown`.
		let _ = done_tx.send(());
	});

	if let Ok(mut guard) = MIRROR.lock() {
		*guard = Some(Shutdown { stop: tx, done: done_rx });
	}
	Ok(Some(format!("http://{ip}:{MIRROR_PORT}")))
}

/// Start or stop answering play commands. `name` is what the sending device
/// lists this one as; `code` is the pairing code shown on this screen.
///
/// `async` for the reason `cast_share` is, plus one of its own: the settings it
/// captures are the name and the code, so changing either restarts the listener
/// — which means this rebinds its port far more often than the mirror does, and
/// has to wait for the last one to let go of it first (see `Shutdown`).
#[tauri::command]
pub async fn cast_receive(app: AppHandle, enable: bool, name: String, code: String) -> Result<(), String> {
	stop_server(&RECEIVER).await;
	if !enable {
		return Ok(());
	}
	// A blank code would pair with anything that forgot to send one.
	if code.is_empty() {
		return Err("a pairing code is required".into());
	}

	let state = Receiving { app, name, code };
	let addr = SocketAddr::from(([0, 0, 0, 0], RECEIVER_PORT));
	// Bound out here rather than inside the task so a port already taken is an
	// error the page can act on, not a line in a log nobody reads.
	let listener = tokio::net::TcpListener::bind(addr)
		.await
		.map_err(|e| format!("could not open port {RECEIVER_PORT}: {e}"))?;

	let (tx, rx) = oneshot::channel();
	let (done_tx, done_rx) = oneshot::channel();
	tauri::async_runtime::spawn(async move {
		let router = Router::new()
			.route("/ventic", get(identity))
			.route("/ventic/play", post(play))
			.route("/ventic/stop", post(stop))
			.with_state(state);

		tokio::select! {
			result = axum::serve(listener, router) => {
				if let Err(e) = result {
					eprintln!("[ventic] cast receiver stopped: {e:#}");
				}
			}
			_ = rx => {}
		}
		let _ = done_tx.send(());
	});

	if let Ok(mut guard) = RECEIVER.lock() {
		*guard = Some(Shutdown { stop: tx, done: done_rx });
	}
	Ok(())
}

/// Answers a probe. Deliberately says nothing but the name: this is reachable
/// by anything on the network, and the code is what gates the part that acts.
async fn identity(State(state): State<Receiving>) -> Json<Identity> {
	Json(Identity { app: "ventic", name: state.name })
}

/// `host:port` out of an http(s) URL — enough to open a socket to, which is all
/// the probe below needs, and not worth a URL parser for.
fn authority(url: &str) -> Option<String> {
	let rest = url.split_once("://")?.1;
	let host = rest.split(['/', '?', '#']).next().filter(|h| !h.is_empty())?;
	// An IPv6 literal is bracketed, so its own colons aren't a port.
	let ported = if host.starts_with('[') { host.contains("]:") } else { host.contains(':') };
	Some(if ported {
		host.to_string()
	} else {
		format!("{host}:{}", if url.starts_with("https") { 443 } else { 80 })
	})
}

/// Can this device actually open a connection to where the film is served?
///
/// The one failure the sending device cannot see for itself: 3231 is *inbound*
/// there, and a desktop firewall drops the request without a word — a TCP
/// connect is exactly what such a rule blocks, so exactly what tests it. Asked
/// here, while the sender is still waiting on this POST, so the complaint
/// arrives on the screen belonging to the machine that has the firewall rather
/// than on a television across the room (see `sendPlay` in utils/cast.ts).
async fn reachable(url: &str) -> bool {
	let Some(authority) = authority(url) else {
		return true; // nothing to test — let the player report what it finds
	};
	matches!(
		tokio::time::timeout(std::time::Duration::from_secs(3), tokio::net::TcpStream::connect(authority)).await,
		Ok(Ok(_))
	)
}

async fn play(State(state): State<Receiving>, Json(mut command): Json<Play>) -> StatusCode {
	// A four-digit code read off a television and typed on a phone, over a
	// network the sender is already on: what matters is that a wrong one is
	// refused, not how long refusing it took.
	if command.code != state.code {
		return StatusCode::FORBIDDEN;
	}
	command.code = String::new();

	// Refuse a film this device can't fetch, rather than showing a spinner and
	// then blaming the link. Checked before the page is sent anywhere, so the
	// sending device is still on screen to be told.
	if !reachable(&command.url).await {
		return StatusCode::BAD_GATEWAY;
	}

	match state.app.emit("cast://play", command) {
		Ok(()) => StatusCode::OK,
		Err(e) => {
			eprintln!("[ventic] cast command could not reach the page: {e:#}");
			StatusCode::INTERNAL_SERVER_ERROR
		}
	}
}

/// "I'm taking it back" — the other end pressing Stop.
///
/// Its own route rather than a flag on `play`: what the sending device wants is
/// for this screen to stop, and it has no film to name. The mirror it was being
/// served from goes down a moment later, so a receiver that never heard this
/// would carry on until its buffer ran dry and then blame the network.
async fn stop(State(state): State<Receiving>, Json(command): Json<Stop>) -> StatusCode {
	if command.code != state.code {
		return StatusCode::FORBIDDEN;
	}
	match state.app.emit("cast://stop", ()) {
		Ok(()) => StatusCode::OK,
		Err(e) => {
			eprintln!("[ventic] cast stop could not reach the page: {e:#}");
			StatusCode::INTERNAL_SERVER_ERROR
		}
	}
}

/// Whether a binary is installed, without asking `PATH` — a desktop app is
/// launched from a session whose `PATH` often has no `/usr/sbin` on it, which is
/// exactly where the answer lives.
#[cfg(target_os = "linux")]
fn installed(binary: &str) -> bool {
	["/usr/bin", "/usr/sbin", "/bin", "/sbin", "/usr/local/bin", "/usr/local/sbin"]
		.iter()
		.any(|dir| std::path::Path::new(dir).join(binary).exists())
}

/// The command that opens the mirror port on this machine, ready to paste.
///
/// Linux only, and that is not an oversight: Windows and macOS put a dialog up
/// the first time the port is bound, and Android has no firewall to be caught
/// by. Linux is the one platform that drops the connection with nothing said
/// anywhere, so it is the one that needs the sentence — and a firewall rule
/// nobody can remember the syntax of is a rule nobody adds.
///
/// Scoped to this device's own subnet on purpose. The mirror is read-only, but
/// it still lists and serves the whole library to whatever can reach it, and
/// that has no business being wider than the network the television is on.
#[tauri::command]
pub fn cast_firewall_hint() -> Option<String> {
	#[cfg(target_os = "linux")]
	{
		let IpAddr::V4(ip) = local_ip()? else {
			return None;
		};
		let [a, b, c, _] = ip.octets();
		let subnet = format!("{a}.{b}.{c}.0/24");

		// ufw unless the box is plainly a firewalld one: ufw is what the
		// distributions most of these installs are on ship, and `firewall-cmd`
		// sits in /usr/bin where it can actually be seen.
		Some(if installed("firewall-cmd") {
			format!(
				"sudo firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address={subnet} port port={MIRROR_PORT} protocol=tcp accept' && sudo firewall-cmd --reload"
			)
		} else {
			format!("sudo ufw allow from {subnet} to any port {MIRROR_PORT} proto tcp")
		})
	}
	#[cfg(not(target_os = "linux"))]
	None
}

#[cfg(test)]
mod tests {
	use std::sync::Mutex;

	use tokio::sync::oneshot;

	use super::{authority, reachable, stop_server, Shutdown};

	/// A server on a port, held the way the two real ones are.
	///
	/// `async move` matters and is not decoration: it puts the listener inside
	/// the future the select is racing, so the socket goes when that future is
	/// dropped — at the end of the select, *before* the word back. Owned by the
	/// task instead, as both real servers would be if they didn't hand theirs to
	/// `axum::serve` and `make_http_api_and_run`, it outlives the word by
	/// however long the task takes to unwind, and the next bind is a coin toss.
	fn hold(slot: &Mutex<Option<Shutdown>>, listener: tokio::net::TcpListener) {
		let (stop, rx) = oneshot::channel();
		let (done_tx, done) = oneshot::channel();
		tokio::spawn(async move {
			tokio::select! {
				_ = async move { loop { let _ = listener.accept().await; } } => {}
				_ = rx => {}
			}
			let _ = done_tx.send(());
		});
		*slot.lock().unwrap() = Some(Shutdown { stop, done });
	}

	/// The restart both servers do — the receiver on every change of name or
	/// code, the mirror on the cast after a cast that ended. Dropping the switch
	/// only *signals* the task; the socket goes when that task is next polled,
	/// which is after this thread has already tried to bind the same fixed port
	/// again. Get this wrong and a cast answers `Address already in use`, and
	/// turning receiving on switches itself straight back off.
	#[test]
	fn restarting_frees_the_port() {
		let rt = tokio::runtime::Runtime::new().unwrap();
		rt.block_on(async {
			let slot: Mutex<Option<Shutdown>> = Mutex::new(None);

			// Whatever the OS hands out — the point is that it is the *same*
			// port every time round, exactly as MIRROR_PORT and RECEIVER_PORT are.
			let first = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
			let port = first.local_addr().unwrap().port();
			hold(&slot, first);

			for turn in 1..=5 {
				stop_server(&slot).await;
				let again = tokio::net::TcpListener::bind(("127.0.0.1", port))
					.await
					.unwrap_or_else(|e| panic!("restart {turn} could not take the port back: {e}"));
				hold(&slot, again);
			}
			stop_server(&slot).await;
		});
	}

	/// What the mirror mints, what a debrid link looks like, and the two shapes
	/// a hand-typed address arrives in.
	#[test]
	fn authorities() {
		assert_eq!(authority("http://192.168.0.191:3231/torrents/13/stream/6").as_deref(), Some("192.168.0.191:3231"));
		assert_eq!(authority("https://host.example/film.mkv?token=x").as_deref(), Some("host.example:443"));
		assert_eq!(authority("http://host.example/film.mkv").as_deref(), Some("host.example:80"));
		// An IPv6 literal's own colons are not a port.
		assert_eq!(authority("http://[fe80::1]/x").as_deref(), Some("[fe80::1]:80"));
		assert_eq!(authority("http://[fe80::1]:3231/x").as_deref(), Some("[fe80::1]:3231"));
		// Nothing to open a socket to: probing is skipped, not failed.
		assert_eq!(authority("/home/tilko/film.mkv"), None);
		assert_eq!(authority("http:///x"), None);
	}

	/// The hint is pasted into a terminal, so it has to be a command. Loose on
	/// purpose — what it says depends on the machine it is read off.
	#[test]
	#[cfg(target_os = "linux")]
	fn firewall_hint() {
		// None is legitimate: a machine with no address on any network.
		if let Some(hint) = super::cast_firewall_hint() {
			println!("firewall hint: {hint}");
			assert!(hint.starts_with("sudo "), "has to be runnable as written");
			assert!(hint.contains(&super::MIRROR_PORT.to_string()), "names the port that is blocked");
			assert!(hint.contains("/24"), "scoped to this device's own subnet, not the whole world");
		}
	}

	/// A dropped connection has to read as unreachable and a live one as fine —
	/// get this backwards and casting either never works or never warns.
	#[test]
	fn reachability() {
		let rt = tokio::runtime::Runtime::new().unwrap();
		let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
		let port = listener.local_addr().unwrap().port();
		assert!(rt.block_on(reachable(&format!("http://127.0.0.1:{port}/torrents/1/stream/0"))));

		// The same address with nobody on it. (A closed port refuses rather than
		// dropping, which is the fast half of what a firewall does slowly.)
		drop(listener);
		assert!(!rt.block_on(reachable(&format!("http://127.0.0.1:{port}/torrents/1/stream/0"))));

		// Not a URL: nothing to test, and not a reason to refuse the film.
		assert!(rt.block_on(reachable("/home/tilko/film.mkv")));
	}
}
