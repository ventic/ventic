//! The Windows title bar, in the colour the app is painted.
//!
//! The app hands the colour it is actually showing to every layer under it —
//! the document, the webview, the window (`app/utils/ground.ts`) — and the title
//! bar was the one it couldn't reach. Windows draws that in the *system's* light
//! or dark: a dark theme sat under a #202020 strip with a seam where the two
//! met, and a light theme on a dark desktop sat under a black bar. Windows 11
//! takes a caption colour per window, so the bar is painted the app's colour,
//! with its title and buttons light or dark against it.
//!
//! The buttons follow the window's own light/dark rather than the caption
//! colour, so that is set too, through tauri's `set_theme` — never as the DWM
//! flag behind its back. The window otherwise *follows the system*, and tao
//! answers any theme message by putting the system's flag back and announcing
//! a change; setting the flag directly was an endless exchange of the two. An
//! explicit theme is also what keeps a switch of Windows' own light/dark from
//! repainting the buttons for the system's colour on top of the app's.
//!
//! Which is why the command is `async`. A plain one runs on the main thread,
//! inside the IPC call the webview is waiting on, and `set_theme` re-themes that
//! same webview: the app froze the first time it had anything to change (dark
//! to light). Off the main thread it is a message to the event loop like any
//! other window call.
//!
//! Windows 10 has no caption colour and refuses the attribute, which is ignored:
//! it keeps the system's bar, as it always had. Linux and macOS draw their own
//! decorations and are left alone — the command is a no-op there.

/// Paint the title bar `colour` (`#rrggbb`), with text and buttons to match.
/// Best-effort by design, like everything else that follows the theme: a bar
/// that stays the system's colour is not an error worth reporting.
#[tauri::command]
pub async fn window_caption(window: tauri::WebviewWindow, colour: String) {
	if let Some(rgb) = parse(&colour) {
		platform::paint(&window, rgb);
	}
}

/// `#rrggbb`, which is all `ramp` in theme/themes.ts ever produces.
fn parse(colour: &str) -> Option<(u8, u8, u8)> {
	let hex = colour.strip_prefix('#')?;
	if hex.len() != 6 {
		return None;
	}
	let byte = |i: usize| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok();
	Some((byte(0)?, byte(2)?, byte(4)?))
}

/// Light text and buttons on this colour, or dark? WCAG's relative luminance,
/// against the point where white and black contrast with it equally.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn is_dark((r, g, b): (u8, u8, u8)) -> bool {
	let lin = |c: u8| {
		let c = f64::from(c) / 255.0;
		if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
	};
	0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.179
}

#[cfg(target_os = "windows")]
mod platform {
	use windows_sys::Win32::Foundation::HWND;
	use windows_sys::Win32::Graphics::Dwm::{
		DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
	};

	pub fn paint(window: &tauri::WebviewWindow, rgb: (u8, u8, u8)) {
		let dark = super::is_dark(rgb);
		let _ = window.set_theme(Some(if dark { tauri::Theme::Dark } else { tauri::Theme::Light }));
		let Ok(hwnd) = window.hwnd() else {
			return;
		};
		let hwnd = hwnd.0 as HWND;
		// A COLORREF is 0x00BBGGRR.
		let (r, g, b) = rgb;
		let caption = u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16;
		let text: u32 = if dark { 0x00ff_ffff } else { 0 };
		unsafe {
			for (attribute, value) in [(DWMWA_CAPTION_COLOR, &caption), (DWMWA_TEXT_COLOR, &text)] {
				DwmSetWindowAttribute(hwnd, attribute as u32, (value as *const u32).cast(), 4);
			}
		}
	}
}

#[cfg(not(target_os = "windows"))]
mod platform {
	pub fn paint(_window: &tauri::WebviewWindow, _rgb: (u8, u8, u8)) {}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_the_hex_the_themes_produce() {
		assert_eq!(parse("#1d1717"), Some((0x1d, 0x17, 0x17)));
		assert_eq!(parse("#FFFBFE"), Some((0xff, 0xfb, 0xfe)));
		assert_eq!(parse("1d1717"), None);
		assert_eq!(parse("#1d17"), None);
		assert_eq!(parse("#zz1717"), None);
		assert_eq!(parse("#1d17é7"), None, "a multi-byte char is not a panic");
	}

	#[test]
	fn dark_grounds_get_light_buttons() {
		assert!(is_dark((0x1d, 0x17, 0x17)), "Ventic Dark");
		assert!(is_dark((0, 0, 0)), "Midnight");
		assert!(!is_dark((0xff, 0xfb, 0xfe)), "a light theme");
		assert!(!is_dark((0xee, 0xe8, 0xf4)));
	}
}
