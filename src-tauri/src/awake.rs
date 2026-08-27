//! Keeping the screen on while a film is playing.
//!
//! Two hours of film is two hours of no keyboard and no mouse, which is exactly
//! what every idle timer is watching for — so a screen blanks, a lock screen
//! comes up, or the machine suspends, in the middle of the one thing the user is
//! definitely still doing. mpv normally says "not now" to the desktop itself
//! (`--stop-screensaver`, on by default), but only from a window it owns, and on
//! the two targets here it owns none:
//!
//!   * **X11** — mpv is embedded in a child window of ours (`player.rs`), and
//!     all its X11 backend does is reset the *X server's* own blanker every ten
//!     seconds. No desktop of the last fifteen years asks the X server: GNOME,
//!     KDE and hypridle all keep their own idle clock, which only real input and
//!     an inhibitor on the bus can move. mpv's own manual says as much.
//!   * **macOS** — there is no mpv window at all. `vo=libmpv` hands us the
//!     frames and we draw them (`player_render_mac.rs`), so the Cocoa code that
//!     would have taken the power assertion never runs.
//!
//! Hence this: one command the player calls with `true` when a film starts
//! playing and `false` when it stops or pauses — the same pairing mpv would have
//! made, since a film left paused at the credits for an hour is not a reason to
//! hold the display up.
//!
//! The other two targets already have an answer and are left alone. Windows is
//! mpv's: it has a real window there, and its window thread holds the request
//! (`SetThreadExecutionState` is per-*thread*, and a Tauri command's thread is
//! not one that outlives the call — ours would need a thread of its own to be
//! worth anything). Android is `MainActivity.setPlayerMode`, which adds
//! `FLAG_KEEP_SCREEN_ON` for as long as the player is up.

/// Ask the OS to keep the display awake, or let it go again. Idempotent, and
/// best-effort by design: a desktop that answers none of this is a desktop that
/// blanks, not an error worth putting on screen mid-film.
#[tauri::command]
pub fn keep_awake(on: bool) {
	platform::set(on);
}

// ----------------------------------------------------------------------------
// Linux — the session bus
// ----------------------------------------------------------------------------
#[cfg(target_os = "linux")]
mod platform {
	use std::sync::Mutex;

	use zbus::blocking::{Connection, Proxy};

	/// Who is asking, and why. Both are shown to the user by some desktops —
	/// KDE lists them in the battery applet, `pmset`'s opposite number.
	const WHO: &str = "Ventic";
	const WHY: &str = "Playing a film";

	/// The services a desktop answers this on: (bus name, object path,
	/// interface). Both take `Inhibit(s app, s reason) -> u cookie` and
	/// `UnInhibit(u)`, which is why they can share one loop.
	///
	/// Two rather than one because they are two different questions and no
	/// desktop implements both: `ScreenSaver` is "don't blank or lock" (GNOME,
	/// KDE, Cinnamon, MATE, hypridle), `PowerManagement` is "don't suspend"
	/// (XFCE, KDE, LXQt). Whichever exists here answers; a name nothing owns
	/// fails on the spot and is skipped.
	const SERVICES: [(&str, &str, &str); 2] = [
		(
			"org.freedesktop.ScreenSaver",
			"/org/freedesktop/ScreenSaver",
			"org.freedesktop.ScreenSaver"
		),
		(
			"org.freedesktop.PowerManagement.Inhibit",
			"/org/freedesktop/PowerManagement/Inhibit",
			"org.freedesktop.PowerManagement.Inhibit"
		)
	];

	/// The connection the inhibitions were taken on and the cookies they
	/// answered with, held for exactly as long as they are.
	///
	/// The connection is part of it on purpose. Every one of these services
	/// drops a client's inhibitions when its bus name disappears — that is what
	/// stops a crashed video player from pinning the screen on forever — so
	/// taking them on a connection of their own means the release cannot fail:
	/// `UnInhibit` is asked politely, and then the socket goes away and the
	/// desktop cleans up regardless.
	static HELD: Mutex<Option<(Connection, Vec<(usize, u32)>)>> = Mutex::new(None);

	pub fn set(on: bool) {
		let Ok(mut held) = HELD.lock() else {
			return;
		};

		if let Some((conn, cookies)) = held.take() {
			for (which, cookie) in cookies {
				let (name, path, interface) = SERVICES[which];
				if let Ok(proxy) = Proxy::new(&conn, name, path, interface) {
					let _: zbus::Result<()> = proxy.call("UnInhibit", &(cookie,));
				}
			}
			drop(conn);
		}

		if !on {
			return;
		}

		// No session bus at all (a TTY, a container) — nothing here to ask.
		let Ok(conn) = Connection::session() else {
			return;
		};
		let mut cookies = Vec::new();
		for (which, (name, path, interface)) in SERVICES.iter().enumerate() {
			let Ok(proxy) = Proxy::new(&conn, *name, *path, *interface) else {
				continue;
			};
			if let Ok(cookie) = proxy.call::<_, _, u32>("Inhibit", &(WHO, WHY)) {
				cookies.push((which, cookie));
			}
		}
		if !cookies.is_empty() {
			*held = Some((conn, cookies));
		}
	}
}

// ----------------------------------------------------------------------------
// macOS — a power assertion
// ----------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod platform {
	use std::ffi::c_void;
	use std::sync::Mutex;

	use objc2_foundation::NSString;

	type IOPMAssertionID = u32;
	type CFStringRef = *const c_void;

	/// `kIOPMAssertionLevelOn`.
	const LEVEL_ON: u32 = 255;

	/// `kIOPMAssertionTypePreventUserIdleDisplaySleep` — the one `caffeinate -d`
	/// takes. It covers system sleep too: a Mac whose display is held awake does
	/// not idle-suspend underneath it.
	const PREVENT_DISPLAY_SLEEP: &str = "PreventUserIdleDisplaySleep";

	/// Shown against the app in `pmset -g assertions`, which is where anyone
	/// wondering why their Mac won't sleep is told to look.
	const WHY: &str = "Ventic is playing a film";

	#[link(name = "IOKit", kind = "framework")]
	extern "C" {
		fn IOPMAssertionCreateWithName(
			assertion_type: CFStringRef,
			level: u32,
			name: CFStringRef,
			id: *mut IOPMAssertionID
		) -> i32;
		fn IOPMAssertionRelease(id: IOPMAssertionID) -> i32;
	}

	static HELD: Mutex<Option<IOPMAssertionID>> = Mutex::new(None);

	pub fn set(on: bool) {
		let Ok(mut held) = HELD.lock() else {
			return;
		};

		if let Some(id) = held.take() {
			unsafe { IOPMAssertionRelease(id) };
		}

		if !on {
			return;
		}

		// IOKit wants CFStrings and we have Foundation already; the two are the
		// same object (toll-free bridged), so an NSString *is* a CFStringRef and
		// nothing needs converting. Both stay alive for the length of the call,
		// which is all IOPMAssertionCreateWithName needs — it copies them.
		let kind = NSString::from_str(PREVENT_DISPLAY_SLEEP);
		let why = NSString::from_str(WHY);
		let mut id: IOPMAssertionID = 0;
		let result = unsafe {
			IOPMAssertionCreateWithName(
				(&*kind as *const NSString).cast(),
				LEVEL_ON,
				(&*why as *const NSString).cast(),
				&mut id
			)
		};
		// kIOReturnSuccess. Anything else left `id` untouched, so there is
		// nothing to release later.
		if result == 0 {
			*held = Some(id);
		}
	}
}

// ----------------------------------------------------------------------------
// Windows, Android — both already covered; see the module doc.
// ----------------------------------------------------------------------------
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
mod platform {
	pub fn set(_on: bool) {}
}
