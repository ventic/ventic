//! The film playing, as the desktop's own media controls see it.
//!
//! A keyboard's play/pause key, a headset's button, the media widget in a panel
//! or on a lock screen: none of them can see into a webview, and none of them
//! can see mpv either — it runs with `--no-config` and no MPRIS script, and on
//! macOS there is no mpv process at all. So the app publishes what is playing
//! itself, and what those controls ask for comes back to the page as a
//! `media://command` event, where `MpvPlayer.vue` answers it with the same
//! functions its own buttons call.
//!
//! One command, `media_session`, called with what is on screen while a film is
//! up and with nothing once it goes — which takes the player off the bus, so a
//! widget never offers to pause a film that has already been closed.
//!
//! Linux is MPRIS (`org.mpris.MediaPlayer2`), which is what `playerctl`, every
//! desktop's media widget and every keyboard binding of the play key talk to.
//! The other targets are a no-op for now: Windows wants SMTC
//! (`SystemMediaTransportControls`), macOS `MPNowPlayingInfoCenter` and Android
//! a `MediaSession`, each a module of its own the day someone writes it — the
//! page needs no change for any of them.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// What is on screen, as the page describes it. Read only where there is a
/// backend to read it — see the module doc.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Debug, Default, Deserialize)]
pub struct NowPlaying {
	pub title: String,
	/// The line under the title: the episode, or the year.
	#[serde(default)]
	pub subtitle: String,
	/// The poster, as an https URL a widget can fetch for itself.
	#[serde(default)]
	pub art: String,
	pub playing: bool,
	/// Seconds.
	pub position: f64,
	/// Seconds, 0 while unknown.
	pub duration: f64,
	/// There is a next episode to go to.
	#[serde(default)]
	pub can_next: bool,
}

/// What the desktop asked for. `seek` is relative and `to` absolute, both in
/// seconds — MPRIS speaks microseconds, the page does not.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum Command {
	Play,
	Pause,
	Toggle,
	Stop,
	Next,
	Seek { by: f64 },
	To { at: f64 },
	Raise,
}

/// Publish what is playing, or take the player off the bus with `None`.
/// Best-effort, like `keep_awake`: a desktop with no session bus has no media
/// controls to tell, which is not worth an error mid-film.
///
/// `async`, and the bus work on a blocking thread, because tauri runs a sync
/// command on the main thread — and this one is called every few seconds of a
/// film with a D-Bus round trip in it, which a slow bus would turn into a
/// stalled window.
#[tauri::command]
pub async fn media_session(app: AppHandle, now: Option<NowPlaying>) {
	let sink: Sink = Arc::new(move |command| send(&app, command));
	let _ = tauri::async_runtime::spawn_blocking(move || platform::set(sink, now)).await;
}

/// Where a command from the desktop goes: the page, in the app, and a list in
/// the test, which is what lets it run without one.
type Sink = Arc<dyn Fn(Command) + Send + Sync>;

/// Hand a command to the page — and, for Raise, which is the window's business
/// rather than the player's, see to it here.
fn send(app: &AppHandle, command: Command) {
	use tauri::Emitter;
	if command == Command::Raise {
		// A phone has no window to raise, and no `unminimize` to do it with.
		#[cfg(desktop)]
		{
			use tauri::Manager;
			if let Some(window) = app.webview_windows().into_values().next() {
				let _ = window.show();
				let _ = window.unminimize();
				let _ = window.set_focus();
			}
		}
		return;
	}
	let _ = app.emit("media://command", command);
}

// ----------------------------------------------------------------------------
// Linux — MPRIS on the session bus
// ----------------------------------------------------------------------------
#[cfg(target_os = "linux")]
mod platform {
	use std::collections::HashMap;
	use std::sync::Mutex;
	use std::time::Instant;

	use zbus::blocking::connection::Builder;
	use zbus::blocking::Connection;
	use zbus::interface;
	use zbus::object_server::SignalEmitter;
	use zbus::zvariant::{ObjectPath, OwnedValue, Value};

	use super::{Command, NowPlaying, Sink};

	/// The well-known name. One instance per desktop is the norm; a second
	/// Ventic loses the race for it and simply isn't listed, which is fine for
	/// an app that refuses to run twice anyway (`tauri_plugin_single_instance`).
	#[cfg(not(test))]
	pub const NAME: &str = "org.mpris.MediaPlayer2.ventic";
	/// Not the app's, so the test can run beside a Ventic playing a film.
	#[cfg(test)]
	pub const NAME: &str = "org.mpris.MediaPlayer2.ventic_test";
	pub const PATH: &str = "/org/mpris/MediaPlayer2";
	/// MPRIS wants a track id; there is only ever the one track.
	pub const TRACK: &str = "/org/ventic/track/0";

	/// The connection, held for as long as a film is up. Dropping it is what
	/// takes the name off the bus.
	static BUS: Mutex<Option<Connection>> = Mutex::new(None);

	pub fn set(sink: Sink, now: Option<NowPlaying>) {
		let Ok(mut bus) = BUS.lock() else {
			return;
		};
		let Some(now) = now else {
			// Released by name before the socket goes: the bus answers that only
			// once the name is gone, where a dropped connection is noticed
			// whenever the daemon gets round to it — and a widget asking in
			// between offers to pause a film that has closed.
			if let Some(conn) = bus.take() {
				let _ = conn.release_name(NAME);
			}
			return;
		};

		if bus.is_none() {
			let built = Builder::session()
				.and_then(|b| b.name(NAME))
				.and_then(|b| b.serve_at(PATH, Root { sink: sink.clone() }))
				.and_then(|b| b.serve_at(PATH, Player { sink, now: now.clone(), at: Instant::now() }))
				.and_then(|b| b.build());
			match built {
				Ok(conn) => *bus = Some(conn),
				Err(e) => {
					eprintln!("[ventic] media controls are not on the bus: {e}");
					return;
				}
			}
			return;
		}

		let Some(conn) = bus.as_ref() else { return };
		let Ok(iface) = conn.object_server().interface::<_, Player>(PATH) else {
			return;
		};
		let emitter = iface.signal_emitter().clone();
		let mut player = iface.get_mut();
		let before = player.now.clone();
		let expected = player.expected();
		player.now = now;
		player.at = Instant::now();
		let after = &player.now;

		zbus::block_on(async {
			if before.playing != after.playing {
				let _ = player.playback_status_changed(&emitter).await;
			}
			if before.title != after.title || before.subtitle != after.subtitle || before.art != after.art || before.duration != after.duration {
				let _ = player.metadata_changed(&emitter).await;
			}
			if before.can_next != after.can_next {
				let _ = player.can_go_next_changed(&emitter).await;
			}
			// A jump the clock can't account for is a seek, and a widget showing
			// a progress bar only learns of one from this signal — Position is a
			// property it reads, not one it is told about.
			if (after.position - expected).abs() > 1.5 {
				let _ = Player::seeked(&emitter, micros(after.position)).await;
			}
		});
	}

	fn micros(seconds: f64) -> i64 {
		(seconds.max(0.0) * 1e6) as i64
	}

	fn value<'a>(v: impl Into<Value<'a>>) -> Option<OwnedValue> {
		OwnedValue::try_from(v.into()).ok()
	}

	struct Root {
		sink: Sink,
	}

	#[interface(name = "org.mpris.MediaPlayer2")]
	impl Root {
		fn raise(&self) {
			(self.sink)(Command::Raise);
		}

		fn quit(&self) {}

		#[zbus(property)]
		fn can_quit(&self) -> bool {
			false
		}

		#[zbus(property)]
		fn can_raise(&self) -> bool {
			true
		}

		#[zbus(property)]
		fn has_track_list(&self) -> bool {
			false
		}

		#[zbus(property)]
		fn identity(&self) -> String {
			"Ventic".into()
		}

		#[zbus(property)]
		fn desktop_entry(&self) -> String {
			"ventic".into()
		}

		#[zbus(property)]
		fn supported_uri_schemes(&self) -> Vec<String> {
			Vec::new()
		}

		#[zbus(property)]
		fn supported_mime_types(&self) -> Vec<String> {
			Vec::new()
		}
	}

	struct Player {
		sink: Sink,
		now: NowPlaying,
		/// When `now` was told, which is what the position runs on from.
		at: Instant,
	}

	impl Player {
		/// Where the film is by now, by the last thing the page said.
		fn expected(&self) -> f64 {
			let ran = if self.now.playing { self.at.elapsed().as_secs_f64() } else { 0.0 };
			let at = self.now.position + ran;
			if self.now.duration > 0.0 { at.min(self.now.duration) } else { at }
		}
	}

	#[interface(name = "org.mpris.MediaPlayer2.Player")]
	impl Player {
		fn play(&self) {
			(self.sink)(Command::Play);
		}

		fn pause(&self) {
			(self.sink)(Command::Pause);
		}

		fn play_pause(&self) {
			(self.sink)(Command::Toggle);
		}

		fn stop(&self) {
			(self.sink)(Command::Stop);
		}

		fn next(&self) {
			if self.now.can_next {
				(self.sink)(Command::Next);
			}
		}

		fn previous(&self) {}

		/// Microseconds, either way.
		fn seek(&self, offset: i64) {
			(self.sink)(Command::Seek { by: offset as f64 / 1e6 });
		}

		/// Ignored for a track that isn't ours, as the spec asks: a stale request
		/// for the last film must not move this one.
		fn set_position(&self, track_id: ObjectPath<'_>, position: i64) {
			if track_id.as_str() == TRACK {
				(self.sink)(Command::To { at: position as f64 / 1e6 });
			}
		}

		fn open_uri(&self, _uri: String) {}

		#[zbus(signal)]
		async fn seeked(emitter: &SignalEmitter<'_>, position: i64) -> zbus::Result<()>;

		#[zbus(property)]
		fn playback_status(&self) -> String {
			if self.now.playing { "Playing" } else { "Paused" }.into()
		}

		#[zbus(property)]
		fn metadata(&self) -> HashMap<String, OwnedValue> {
			let mut map = HashMap::new();
			let track = ObjectPath::try_from(TRACK).ok();
			if let Some(v) = track.and_then(value) {
				map.insert("mpris:trackid".into(), v);
			}
			if let Some(v) = value(self.now.title.clone()) {
				map.insert("xesam:title".into(), v);
			}
			// Where a music player puts the artist, which is the line every
			// widget shows under the title.
			if !self.now.subtitle.is_empty() {
				if let Some(v) = value(vec![self.now.subtitle.clone()]) {
					map.insert("xesam:artist".into(), v);
				}
			}
			if !self.now.art.is_empty() {
				if let Some(v) = value(self.now.art.clone()) {
					map.insert("mpris:artUrl".into(), v);
				}
			}
			if self.now.duration > 0.0 {
				if let Some(v) = value(micros(self.now.duration)) {
					map.insert("mpris:length".into(), v);
				}
			}
			map
		}

		#[zbus(property)]
		fn position(&self) -> i64 {
			micros(self.expected())
		}

		#[zbus(property)]
		fn rate(&self) -> f64 {
			1.0
		}

		#[zbus(property)]
		fn minimum_rate(&self) -> f64 {
			1.0
		}

		#[zbus(property)]
		fn maximum_rate(&self) -> f64 {
			1.0
		}

		#[zbus(property)]
		fn volume(&self) -> f64 {
			1.0
		}

		#[zbus(property)]
		fn can_go_next(&self) -> bool {
			self.now.can_next
		}

		#[zbus(property)]
		fn can_go_previous(&self) -> bool {
			false
		}

		#[zbus(property)]
		fn can_play(&self) -> bool {
			true
		}

		#[zbus(property)]
		fn can_pause(&self) -> bool {
			true
		}

		#[zbus(property)]
		fn can_seek(&self) -> bool {
			true
		}

		#[zbus(property)]
		fn can_control(&self) -> bool {
			true
		}
	}
}

// ----------------------------------------------------------------------------
// Everywhere else — see the module doc.
// ----------------------------------------------------------------------------
#[cfg(not(target_os = "linux"))]
mod platform {
	use super::{NowPlaying, Sink};

	pub fn set(_sink: Sink, _now: Option<NowPlaying>) {}
}

/// Run on the real session bus, as a desktop's widget would see it: what is
/// published, and what comes back when it is pressed. Skipped where there is no
/// bus to stand on (a container, CI).
#[cfg(all(test, target_os = "linux"))]
mod tests {
	use std::collections::HashMap;
	use std::sync::{Arc, Mutex};

	use zbus::blocking::{Connection, Proxy};
	use zbus::zvariant::{ObjectPath, OwnedValue};

	use super::platform::{set, NAME, PATH, TRACK};
	use super::{Command, NowPlaying};

	fn film(playing: bool, position: f64) -> NowPlaying {
		NowPlaying {
			title: "Breaking Bad".into(),
			subtitle: "S2 E5".into(),
			art: "https://image.tmdb.org/t/p/w342/poster.jpg".into(),
			playing,
			position,
			duration: 2880.0,
			can_next: true,
		}
	}

	#[test]
	fn mpris() {
		let Ok(client) = Connection::session() else {
			eprintln!("no session bus here; skipping");
			return;
		};
		let heard = Arc::new(Mutex::new(Vec::new()));
		let sink = {
			let heard = heard.clone();
			Arc::new(move |c: Command| heard.lock().unwrap().push(c))
		};

		set(sink.clone(), Some(film(true, 600.0)));
		let player = Proxy::new(&client, NAME, PATH, "org.mpris.MediaPlayer2.Player").unwrap();
		let root = Proxy::new(&client, NAME, PATH, "org.mpris.MediaPlayer2").unwrap();

		assert_eq!(root.get_property::<String>("Identity").unwrap(), "Ventic");
		assert_eq!(player.get_property::<String>("PlaybackStatus").unwrap(), "Playing");
		let meta: HashMap<String, OwnedValue> = player.get_property("Metadata").unwrap();
		assert_eq!(String::try_from(meta["xesam:title"].clone()).unwrap(), "Breaking Bad");
		assert_eq!(i64::try_from(meta["mpris:length"].clone()).unwrap(), 2_880_000_000);
		assert!(player.get_property::<i64>("Position").unwrap() >= 600_000_000, "the clock runs on from what the page said");
		assert!(player.get_property::<bool>("CanGoNext").unwrap());

		let _: () = player.call("PlayPause", &()).unwrap();
		let _: () = player.call("Seek", &(-10_000_000i64,)).unwrap();
		let _: () = player.call("SetPosition", &(ObjectPath::try_from(TRACK).unwrap(), 90_000_000i64)).unwrap();
		let _: () = player.call("SetPosition", &(ObjectPath::try_from("/org/other/track").unwrap(), 5_000_000i64)).unwrap();
		let _: () = player.call("Next", &()).unwrap();
		let _: () = root.call("Raise", &()).unwrap();
		assert_eq!(
			*heard.lock().unwrap(),
			vec![Command::Toggle, Command::Seek { by: -10.0 }, Command::To { at: 90.0 }, Command::Next, Command::Raise],
			"a stale track's SetPosition is ignored"
		);

		// Paused from the page: the widget is *told* — the proxy here caches
		// properties exactly as a widget does, and only a PropertiesChanged
		// signal moves it, so seeing the change land is seeing the signal sent.
		set(sink.clone(), Some(film(false, 610.0)));
		let told = (0..40).any(|_| {
			std::thread::sleep(std::time::Duration::from_millis(50));
			player.get_property::<String>("PlaybackStatus").unwrap() == "Paused"
		});
		assert!(told, "PlaybackStatus never changed for a client that caches it");

		// The film closed: off the bus, so nothing offers to pause it.
		set(sink, None);
		let dbus = zbus::blocking::fdo::DBusProxy::new(&client).unwrap();
		assert!(!dbus.name_has_owner(NAME.try_into().unwrap()).unwrap());
	}
}
