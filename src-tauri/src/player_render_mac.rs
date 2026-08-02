// ----------------------------------------------------------------------------
// The macOS video surface — libmpv's render API into an NSOpenGLView
//
// Every other backend hands mpv a window to draw into and lets it get on with
// it. macOS allows neither half of that: no process may embed another's window,
// and mpv's own Cocoa output takes no `--wid` (the manual offers it for X11,
// win32 and Android). What libmpv does offer is `--vo=libmpv`, where mpv hands
// *us* the frames and we put them on screen — so the picture is an NSOpenGLView
// this file owns, and mpv renders into its GL context.
//
// Two consequences run through everything below:
//
//   - The view goes *under* the WKWebView, not over it, which is the one place
//     this backend is unlike X11 and Win32 and exactly like Android's
//     SurfaceView. WebKit's own layer is switched to non-opaque so the page can
//     be see-through down to the video box (`html.ventic-video` in
//     MpvPlayer.vue), and the controls are then ordinary DOM on top. No shaped
//     window, no cutouts, no clicks to forward: the webview is in front and
//     gets them all.
//   - AppKit and the GL context belong to the main thread, and so does mpv's
//     render call. Commands arrive on Tauri's worker threads, so every entry
//     point here demands a `MainThreadMarker` and the callers hop first
//     (`run_on_main_thread`). mpv's "new frame" callback arrives on its own
//     thread and is bounced to the main queue by `schedule_redraw`.
//
// The shape of this — pixel format, view insertion, webview transparency, the
// redraw hop — follows Harbor (github.com/harborstremio/harbor), which solved
// the same problem in the same stack first.
// ----------------------------------------------------------------------------

// Apple deprecated OpenGL in favour of Metal, and mpv's render API speaks
// OpenGL or software — there is no Metal path to move to. Deprecated here means
// "no longer developed", not "removed": it is what every libmpv-based player on
// the platform still draws with.
#![allow(deprecated)]

use std::ffi::{c_char, c_void, CString};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2_sys::mpv_handle;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send, AnyThread, ClassType, MainThreadOnly};
use objc2_app_kit::{NSOpenGLPixelFormat, NSOpenGLView, NSView, NSWindow, NSWindowOrderingMode};
use objc2_foundation::{MainThreadMarker, NSNumber, NSPoint, NSRect, NSSize, NSString};

// NSOpenGLPixelFormatAttribute values. objc2-app-kit exposes the enum, but as
// plain u32 constants they read the same as every Cocoa sample that documents
// this, which is worth more than the type here.
const NSOPENGLPFA_OPENGL_PROFILE: u32 = 99;
const NSOPENGLPFA_DOUBLEBUFFER: u32 = 5;
const NSOPENGLPFA_COLOR_SIZE: u32 = 8;
const NSOPENGLPFA_DEPTH_SIZE: u32 = 12;
const NSOPENGLPFA_ACCELERATED: u32 = 73;
const NSOPENGLPFA_NO_RECOVERY: u32 = 72;
const NSOPENGL_PROFILE_VERSION_3_2_CORE: u32 = 0x3200;

/// `NSOpenGLCPSurfaceOpacity`: the video is opaque, so the compositor need not
/// blend it with the black window behind.
const NSOPENGL_CONTEXT_PARAM_SURFACE_OPACITY: i32 = 236;

extern "C" {
	fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
	fn dispatch_async_f(queue: *mut c_void, ctx: *mut c_void, work: extern "C" fn(*mut c_void));
	static _dispatch_main_q: c_void;
}
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

fn main_queue() -> *mut c_void {
	unsafe { (&_dispatch_main_q as *const c_void) as *mut c_void }
}

/// The video box, in physical pixels relative to the webview viewport's
/// top-left, plus the size of that viewport.
///
/// The viewport comes along so the mapping onto AppKit points is a ratio rather
/// than an assumption about the backing scale: the page measures in CSS pixels
/// under a `zoom`, and every guess at how those two relate is a video parked in
/// the wrong place on somebody's display.
#[derive(Clone, Copy)]
pub struct Geometry {
	pub x: f64,
	pub y: f64,
	pub width: f64,
	pub height: f64,
	pub view_w: f64,
	pub view_h: f64,
}

pub struct Embed {
	view: Retained<NSOpenGLView>,
	/// The WKWebView, whose opacity we turn off and have to put back.
	web_view: Option<Retained<NSView>>,
	web_view_was_opaque: bool,
	render: Mutex<RenderContext>,
}

// SAFETY: the embed lives in a process-global slot, but every path that touches
// or drops it first proves it is on the main thread.
unsafe impl Send for Embed {}

static EMBED: OnceLock<Mutex<Option<Embed>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<Embed>> {
	EMBED.get_or_init(|| Mutex::new(None))
}

/// Frame in the parent's coordinates. AppKit's origin is bottom-left unless the
/// parent says otherwise, so the page's top-left `y` has to be flipped.
fn frame_in(parent: &NSView, g: Geometry) -> NSRect {
	let bounds = parent.bounds();
	// A viewport we can't scale against means the page hasn't laid out; fill the
	// parent rather than collapsing to nothing.
	if !(g.view_w > 0.0 && g.view_h > 0.0 && g.width > 0.0 && g.height > 0.0) {
		return bounds;
	}
	let sx = bounds.size.width / g.view_w;
	let sy = bounds.size.height / g.view_h;
	let width = (g.width * sx).max(1.0);
	let height = (g.height * sy).max(1.0);
	let x = g.x * sx;
	let top = g.y * sy;
	let y = if parent.isFlipped() { top } else { bounds.size.height - top - height };
	NSRect { origin: NSPoint { x, y }, size: NSSize { width, height } }
}

/// Create the video view, put it under the webview, and point mpv's renderer at
/// its GL context. Main thread only.
pub fn install(mpv_ctx: NonNull<mpv_handle>, ns_window_ptr: isize, geometry: Geometry) -> Result<(), String> {
	let mtm = MainThreadMarker::new().ok_or("the video surface must be built on the main thread")?;
	if ns_window_ptr == 0 {
		return Err("the app window has no NSWindow".into());
	}

	// A previous film's surface would otherwise keep its GL context and its
	// place in the view hierarchy.
	if let Some(stale) = slot().lock().map_err(|e| e.to_string())?.take() {
		teardown(stale);
	}

	unsafe {
		let ns_window: &NSWindow = &*(ns_window_ptr as *const NSWindow);
		let content_view = ns_window.contentView().ok_or("the app window has no content view")?;

		let attrs: [u32; 13] = [
			NSOPENGLPFA_OPENGL_PROFILE,
			NSOPENGL_PROFILE_VERSION_3_2_CORE,
			NSOPENGLPFA_DOUBLEBUFFER,
			1,
			NSOPENGLPFA_ACCELERATED,
			1,
			NSOPENGLPFA_NO_RECOVERY,
			1,
			NSOPENGLPFA_COLOR_SIZE,
			24,
			NSOPENGLPFA_DEPTH_SIZE,
			16,
			0,
		];
		let pf: Option<Retained<NSOpenGLPixelFormat>> =
			msg_send![NSOpenGLPixelFormat::alloc(), initWithAttributes: attrs.as_ptr()];
		let pf = pf.ok_or("no accelerated OpenGL pixel format on this machine")?;

		let view: Option<Retained<NSOpenGLView>> =
			msg_send![NSOpenGLView::alloc(mtm), initWithFrame: content_view.bounds(), pixelFormat: &*pf];
		let view = view.ok_or("NSOpenGLView would not initialise")?;
		// Retina: without this the view renders at 1x and is scaled up.
		let _: () = msg_send![&*view, setWantsBestResolutionOpenGLSurface: true];
		let as_view: &NSView = view.as_super();

		// Under the webview, which is the window's first subview. The page is
		// then free to draw the controls over the picture in CSS.
		let subviews = content_view.subviews();
		let web_view: Option<Retained<NSView>> = subviews.firstObject();
		match web_view.as_deref() {
			Some(front) => content_view.addSubview_positioned_relativeTo(
				as_view,
				NSWindowOrderingMode::Below,
				Some(front),
			),
			None => content_view.addSubview(as_view),
		}
		as_view.setFrame(frame_in(&content_view, geometry));

		// Black behind the picture: mpv letterboxes inside the box, and the
		// window's own background would otherwise show in the bars.
		let _: () = msg_send![as_view, setWantsLayer: true];
		if let Some(layer) = as_view.layer() {
			let black: *mut AnyObject = msg_send![class!(NSColor), blackColor];
			let cg_black: *mut AnyObject = msg_send![&*black, CGColor];
			let _: () = msg_send![&*layer, setBackgroundColor: cg_black];
			let _: () = msg_send![&*layer, setOpaque: true];
		}

		let gl_ctx = view.openGLContext().ok_or("the view has no GL context")?;
		gl_ctx.makeCurrentContext();
		let opaque: i32 = 1;
		let _: () = msg_send![
			&*gl_ctx,
			setValues: (&opaque) as *const i32,
			forParameter: NSOPENGL_CONTEXT_PARAM_SURFACE_OPACITY,
		];

		// WebKit paints an opaque background by default, which would hide the
		// view we just put behind it. Remembered, because it has to go back:
		// every other page in the app expects to be drawn on something.
		let mut web_view_was_opaque = true;
		if let Some(wv) = web_view.as_deref() {
			web_view_was_opaque = msg_send![wv, isOpaque];
			let _: () = msg_send![wv, setWantsLayer: true];
			let no = NSNumber::new_bool(false);
			let key = NSString::from_str("drawsBackground");
			let _: () = msg_send![wv, setValue: &*no, forKey: &*key];
			if let Some(layer) = wv.layer() {
				let _: () = msg_send![&*layer, setOpaque: false];
			}
		}

		let params: Vec<RenderParam<()>> = vec![
			RenderParam::ApiType(RenderParamApiType::OpenGl),
			RenderParam::InitParams(OpenGLInitParams { get_proc_address, ctx: () }),
		];
		let mut render = match RenderContext::new(&mut *mpv_ctx.as_ptr(), params) {
			Ok(render) => render,
			Err(e) => {
				// The view is already in the hierarchy and WebKit is already
				// see-through. Leaving it that way would be a transparent app
				// with a black rectangle in it and no way back.
				as_view.removeFromSuperview();
				restore(web_view.as_deref(), web_view_was_opaque);
				return Err(format!("mpv's renderer would not start: {e:?}"));
			}
		};
		// Called from mpv's own thread whenever a frame is ready.
		render.set_update_callback(schedule_redraw);

		*slot().lock().map_err(|e| e.to_string())? = Some(Embed {
			view,
			web_view,
			web_view_was_opaque,
			render: Mutex::new(render),
		});
	}
	Ok(())
}

/// Track the page's video box. Main thread only.
pub fn resize_to(geometry: Geometry, visible: bool) {
	if MainThreadMarker::new().is_none() {
		return;
	}
	let Ok(guard) = slot().lock() else { return };
	let Some(embed) = guard.as_ref() else { return };

	unsafe {
		let as_view: &NSView = embed.view.as_super();
		as_view.setHidden(!visible);
		if let Some(parent) = as_view.superview() {
			as_view.setFrame(frame_in(&parent, geometry));
		}
		if let Some(gl_ctx) = embed.view.openGLContext() {
			// The context caches the surface size; without this the next frame
			// is drawn at the old one.
			let _: () = msg_send![&*gl_ctx, update];
		}
	}
	drop(guard);
	schedule_redraw();
}

/// Draw one frame. Main thread only — it is the thread the GL context is
/// current on.
pub fn render_now() {
	if MainThreadMarker::new().is_none() {
		return;
	}
	let Ok(guard) = slot().lock() else { return };
	let Some(embed) = guard.as_ref() else { return };

	unsafe {
		let Some(gl_ctx) = embed.view.openGLContext() else { return };
		gl_ctx.makeCurrentContext();
		let as_view: &NSView = embed.view.as_super();
		let bounds = as_view.bounds();
		// mpv wants pixels, and a Retina view's bounds are points.
		let backing: NSRect = msg_send![as_view, convertRectToBacking: bounds];
		let (w, h) = (backing.size.width as i32, backing.size.height as i32);
		if w <= 0 || h <= 0 {
			return;
		}
		let Ok(render) = embed.render.lock() else { return };
		// fbo 0 is the view's own framebuffer; flip, because GL's origin is at
		// the bottom and mpv's frame is top-down.
		let _ = render.render::<()>(0, w, h, true);
		gl_ctx.flushBuffer();
	}
}

/// Take the surface back out and give the webview its background back.
/// Main thread only, because it drops the render context.
pub fn uninstall() {
	if MainThreadMarker::new().is_none() {
		return;
	}
	let embed = slot().lock().ok().and_then(|mut g| g.take());
	if let Some(embed) = embed {
		teardown(embed);
	}
}

fn teardown(embed: Embed) {
	let as_view: &NSView = embed.view.as_super();
	as_view.removeFromSuperview();
	restore(embed.web_view.as_deref(), embed.web_view_was_opaque);
	// `embed` drops here, on the main thread, which is where mpv's render
	// context has to be freed.
}

/// Give WebKit its background back. Every page but the player expects to be
/// drawn on something.
fn restore(web_view: Option<&NSView>, was_opaque: bool) {
	let Some(wv) = web_view else { return };
	unsafe {
		let value = NSNumber::new_bool(was_opaque);
		let key = NSString::from_str("drawsBackground");
		let _: () = msg_send![wv, setValue: &*value, forKey: &*key];
		if let Some(layer) = wv.layer() {
			let _: () = msg_send![&*layer, setOpaque: was_opaque];
		}
	}
}

/// How mpv finds the GL functions. Everything it asks for is already in the
/// process — OpenGL.framework is linked by the view above.
fn get_proc_address(_ctx: &(), name: &str) -> *mut c_void {
	let Ok(cstr) = CString::new(name) else { return std::ptr::null_mut() };
	unsafe { dlsym(RTLD_DEFAULT, cstr.as_ptr()) }
}

static REDRAW_PENDING: AtomicBool = AtomicBool::new(false);

/// Ask the main thread for a frame. Called from mpv's render thread, so it may
/// touch nothing here but the flag — and coalesces, because mpv can signal
/// faster than the display refreshes.
fn schedule_redraw() {
	if REDRAW_PENDING.swap(true, Ordering::AcqRel) {
		return;
	}
	extern "C" fn redraw(_ctx: *mut c_void) {
		REDRAW_PENDING.store(false, Ordering::Release);
		render_now();
	}
	unsafe { dispatch_async_f(main_queue(), std::ptr::null_mut(), redraw) }
}
