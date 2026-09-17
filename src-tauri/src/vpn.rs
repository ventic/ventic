//! Keeping torrent traffic on a VPN, and off the network when the VPN goes.
//!
//! The engine is **bound** to the interface the user picks — librqbit's
//! `bind_device_name`, which is `SO_BINDTODEVICE` on Linux and `IP_BOUND_IF` on
//! macOS, and reaches the DHT, peers over TCP and uTP, both kinds of tracker and
//! local discovery. That is the whole kill switch, and it is why nothing here
//! watches for a leak: a socket tied to `wg0` has no other way out, so the moment
//! the tunnel drops its sends fail, before any check could have noticed.
//! Recognising a VPN by its address needs somebody's lookup service, and watching
//! for the public address to change trips on every ISP that hands out a new one —
//! and both only notice a leak once the tracker has already logged it.
//!
//! Two things binding doesn't do by itself, and they are this module:
//!
//!   * **The tunnel is down when the engine starts.** librqbit refuses an
//!     interface that doesn't exist, so the engine is bound to loopback instead:
//!     up, serving what is already on disk, and able to reach nothing else.
//!   * **The tunnel comes back as a different interface.** wg-quick, OpenVPN and
//!     NetworkManager create the device again on reconnect, under a new index,
//!     and a socket is bound to the index rather than the name — the DHT's, uTP's
//!     and the listening port's would stay tied to the one that is gone, for
//!     good. So [`changed`] watches the index, and the engine starts again when it
//!     moves (see `run_torrent_server`).
//!
//! Windows can't: librqbit-dualstack-sockets has no bind there
//! (`BindDeviceNotSupported`), so the setting doesn't exist on it. Android has a
//! better answer than ours — *Always-on VPN* with *Block connections without
//! VPN*, which the OS enforces for every app.
//!
//! The choice is a file in the app's data folder, not a `ventic.` key: the engine
//! starts before there is a page to ask, and a torrent resumed in that gap would
//! announce from the real address. An interface name also means nothing on
//! another machine, so it is right that no backup or sync ever carries it.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

/// Where binding works at all — see the module comment for the other two.
const SUPPORTED: bool = cfg!(any(target_os = "linux", target_os = "macos"));

/// How soon a tunnel that came back gets its torrents back.
const EVERY: Duration = Duration::from_secs(3);

/// The interface the engine is to be bound to, `None` for whichever the OS picks.
static DEVICE: Mutex<Option<String>> = Mutex::new(None);

fn file(app: &tauri::AppHandle) -> Option<PathBuf> {
	app.path().app_data_dir().ok().map(|dir| dir.join("engine-interface"))
}

fn loopback() -> &'static str {
	if cfg!(target_os = "macos") { "lo0" } else { "lo" }
}

/// The interface's index right now, 0 when there is none by that name.
#[cfg(unix)]
fn index(name: &str) -> u32 {
	let Ok(name) = std::ffi::CString::new(name) else { return 0 };
	unsafe { libc::if_nametoindex(name.as_ptr()) }
}

#[cfg(not(unix))]
fn index(_name: &str) -> u32 {
	0
}

/// Read the choice back. Before the engine first starts, or it starts unbound.
pub fn load(app: &tauri::AppHandle) {
	if !SUPPORTED {
		return;
	}
	let name = file(app)
		.and_then(|path| std::fs::read_to_string(path).ok())
		.map(|name| name.trim().to_owned())
		.filter(|name| !name.is_empty());
	if let Ok(mut device) = DEVICE.lock() {
		*device = name;
	}
}

/// What an engine was started against: the interface asked for, and the index
/// it had then.
#[derive(Clone, Debug, PartialEq)]
pub struct Binding {
	pub device: Option<String>,
	index: u32,
}

pub fn current() -> Binding {
	let device = DEVICE.lock().ok().and_then(|device| device.clone());
	let index = device.as_deref().map_or(0, index);
	Binding { device, index }
}

impl Binding {
	/// For `bind_device_name`. An interface that was asked for and isn't there is
	/// loopback, never `None` — `None` is every interface, which is the leak.
	pub fn device_name(&self) -> Option<String> {
		self.device.as_ref().map(|name| if self.index == 0 { loopback().to_owned() } else { name.clone() })
	}

	/// Whether there is a network to reach at all.
	pub fn online(&self) -> bool {
		self.device.is_none() || self.index != 0
	}
}

/// Resolves once the engine has to start again: the setting changed, or the
/// interface went, came back, or came back as another one.
///
/// Going is a restart too, though its sockets already fail: it puts the DHT to
/// sleep rather than letting it time out every node it saved, and a BSD kernel
/// hands a freed index to the next interface to ask — which could be anything.
pub async fn changed(started: &Binding) {
	loop {
		tokio::time::sleep(EVERY).await;
		if current() != *started {
			return;
		}
	}
}

#[derive(serde::Serialize)]
pub struct Interface {
	name: String,
	/// What tells a tunnel from the rest: `utun0` to `utun4` are all there on a
	/// Mac, and only the VPN's has an address anyone would recognise.
	addresses: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct Interfaces {
	bound: Option<String>,
	available: Vec<Interface>,
}

/// What there is to bind to, and what is bound. `None` where binding isn't
/// possible, which is what hides the setting.
#[tauri::command]
pub fn engine_interfaces() -> Option<Interfaces> {
	use network_interface::{NetworkInterface, NetworkInterfaceConfig};

	if !SUPPORTED {
		return None;
	}
	let mut available: Vec<_> = NetworkInterface::show()
		.unwrap_or_default()
		.into_iter()
		.filter(|interface| !interface.internal)
		.map(|interface| Interface {
			addresses: interface
				.addr
				.iter()
				.map(|addr| addr.ip())
				// Every interface has one of these, so they tell nothing apart.
				.filter(|ip| !matches!(ip, std::net::IpAddr::V6(v6) if v6.is_unicast_link_local()))
				.map(|ip| ip.to_string())
				.collect(),
			name: interface.name,
		})
		.collect();
	available.sort_by(|a, b| a.name.cmp(&b.name));
	Some(Interfaces { bound: current().device, available })
}

/// Bind the engine to `name`, or to nothing. It starts again within [`EVERY`].
///
/// Written to disk before it takes effect, so an answer the next launch would
/// not remember is an error here and not a kill switch that quietly isn't one.
#[tauri::command]
pub fn set_engine_interface(app: tauri::AppHandle, name: Option<String>) -> Result<(), String> {
	if !SUPPORTED {
		return Err("binding to an interface isn't possible on this system".into());
	}
	let name = name.map(|name| name.trim().to_owned()).filter(|name| !name.is_empty());
	let path = file(&app).ok_or("this app has no data folder to remember that in")?;
	match &name {
		Some(name) => path
			.parent()
			.map_or(Ok(()), std::fs::create_dir_all)
			.and_then(|_| std::fs::write(&path, name)),
		None => std::fs::remove_file(&path).or_else(|e| match e.kind() {
			std::io::ErrorKind::NotFound => Ok(()),
			_ => Err(e),
		}),
	}
	.map_err(|e| e.to_string())?;
	*DEVICE.lock().map_err(|e| e.to_string())? = name;
	Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
	use std::net::Ipv4Addr;

	use librqbit::spawn_utils::BlockingSpawner;
	use librqbit::{create_torrent, AddTorrent, AddTorrentOptions, CreateTorrentOptions, ListenerOptions, Session, SessionOptions};
	use network_interface::{NetworkInterface, NetworkInterfaceConfig};
	use tokio::time::timeout;

	use super::*;

	fn scratch(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("ventic-vpn-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	/// The kill switch end to end, against a seeder on 127.0.0.1. Bound to an
	/// interface, the engine reaches nothing that isn't on it; with its interface
	/// gone, it is bound to loopback and still starts — the engine going down
	/// would take every film already on disk with it.
	#[tokio::test(flavor = "multi_thread")]
	async fn bound_reaches_nothing_else() {
		let missing = Binding { device: Some("ventic-gone".into()), index: 0 };
		assert_eq!(missing.device_name().as_deref(), Some("lo"), "a missing interface is loopback, never every interface");
		assert!(!missing.online());

		let seed_dir = scratch("seed");
		std::fs::write(seed_dir.join("film.mkv"), vec![7u8; 1 << 20]).unwrap();
		let torrent = create_torrent(&seed_dir.join("film.mkv"), CreateTorrentOptions::default(), &BlockingSpawner::new(1))
			.await
			.unwrap()
			.as_bytes()
			.unwrap();
		let seeder = Session::new_with_opts(
			seed_dir.clone(),
			SessionOptions {
				dht: None,
				disable_local_service_discovery: true,
				listen: Some(ListenerOptions { listen_addr: (Ipv4Addr::LOCALHOST, 0).into(), ..Default::default() }),
				..Default::default()
			},
		)
		.await
		.unwrap();
		seeder
			.add_torrent(
				AddTorrent::from_bytes(torrent.clone()),
				Some(AddTorrentOptions { output_folder: Some(seed_dir.to_string_lossy().into_owned()), overwrite: true, ..Default::default() }),
			)
			.await
			.unwrap()
			.into_handle()
			.unwrap()
			.wait_until_completed()
			.await
			.unwrap();

		// How long a leecher gets to fetch the film from the seeder.
		let fetch = |device: Option<String>, name: &'static str| {
			let torrent = torrent.clone();
			let peer = seeder.listen_addr().unwrap();
			async move {
				let dir = scratch(name);
				let leecher = Session::new_with_opts(
					dir.clone(),
					SessionOptions { dht: None, disable_local_service_discovery: true, bind_device_name: device, ..Default::default() },
				)
				.await
				.expect("a bound engine still starts");
				let handle = leecher
					.add_torrent(
						AddTorrent::from_bytes(torrent),
						Some(AddTorrentOptions {
							initial_peers: Some(vec![peer]),
							output_folder: Some(dir.to_string_lossy().into_owned()),
							overwrite: true,
							..Default::default()
						}),
					)
					.await
					.unwrap()
					.into_handle()
					.unwrap();
				let done = timeout(Duration::from_secs(5), handle.wait_until_completed()).await.is_ok();
				leecher.stop().await;
				let _ = std::fs::remove_dir_all(dir);
				done
			}
		};

		assert!(fetch(missing.device_name(), "loopback").await, "bound to loopback, loopback is reachable");

		// Any interface that isn't loopback stands in for a tunnel.
		let Some(tunnel) = NetworkInterface::show().unwrap().into_iter().find(|i| !i.internal) else {
			eprintln!("no interface but loopback here, so nothing to bind away from it");
			return;
		};
		assert!(!fetch(Some(tunnel.name), "tunnel").await, "bound elsewhere, a peer on loopback is out of reach");

		let _ = std::fs::remove_dir_all(seed_dir);
	}
}
