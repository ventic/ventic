# Android: the freeze, and the process that refuses to die

**Status:** two linked faults, neither fixed. Needs a device to finish.
**Reported as:** "app just freezes after a while and nothing happens, it becomes
completely unresponsive — on some devices."
**Upstream:** github.com/ventic/ventic issue #30 (Samsung A54, Android 16).

**Measured 2026-09-08 across two independent debugging sessions on the same
borrowed phone.** The phone has since gone home. Everything below is evidence,
not theory, except where it says otherwise.

---

## The short version — there are TWO faults, not one

They were found separately and each explains a different half of what the user
sees. Neither on its own accounts for the whole report.

**Phase 1 — the freeze.** While the app is still perfectly alive, the WebView's
**renderer main thread deadlocks in native code**. Input stops being processed,
the page stops repainting or repaints pathologically, and Android marks the
window `not responsive`. The Rust side is untouched and still serving.

**Phase 2 — the unkillable zombie.** MIUI's app killer then force-stops the
unresponsive app. 83 of 85 threads exit in ~120 ms; the **`JavaBridge`** thread
spins in kernel space with SIGKILL pending for **100–150 s**. AMS gives up after
2 s and cancels every relaunch; SurfaceFlinger has not released the window, so
the last frame stays on screen.

From the sofa: *it freezes, then closes itself, then won't reopen.* That is
exactly the sequence in the issue.

> The two phases were found by two sessions that did not share notes, so treat
> the causal link between them ("unresponsive → MIUI kills it") as the obvious
> reading rather than a measured fact. It has not been demonstrated that Phase 2
> only ever follows Phase 1 — see *Open questions*.

---

## Test environment

Both sessions used one device. Both build types matter when reading results.

| | |
|---|---|
| Device | Redmi Note 10S (`rosemary_eea`, `M2101K7BNY`), MediaTek Helio G95 / Mali-G76 |
| OS | MIUI `V14.0.11.0.TKLEUXM`, Android 13 (`TP1A.220624.014`) |
| WebView | `com.google.android.webview` **152.0.7977.64**, `multiprocess=true` |
| RAM | 6 GB, and in practice **full** — 83 MB free / 1.3 GB in ZRAM during one run |
| Access | `adb` as `shell` — **no root** |

Three different builds were used. Do not mix their results:

| Build | Signed | devtools | Time to freeze |
|---|---|---|---|
| **Release** v0.6.1, as the user had it | release key | no | **~90 s of tapping** |
| **`tauri android dev`** (dev server over `adb reverse`) | debug | yes | seconds — **but confounded, see below** |
| **`--debug --apk`, production bundle** | debug | yes | **1–3 taps**, sometimes before any tap |

The `--debug --apk` build is the good instrument: devtools work, and there is no
dev-server proxy in the request path. It is ~10× slower than release, which is
almost certainly why it wedges in seconds rather than 90 s — the fault is
timing-sensitive, and CheckJNI (on in debug, see the profile below) makes every
JNI hop far more expensive.

> The release measurements were taken on the copy the user actually had:
> `versionName=0.6.1`, `versionCode=6001`, `primaryCpuAbi=arm64-v8a`,
> `installerPackageName=com.google.android.packageinstaller`. Note that last
> field — **that copy was sideloaded, not a Play install**, despite being
> described as one. The Play build differs (no `REQUEST_INSTALL_PACKAGES`).

---

## Phase 1 — the freeze itself

Measured on the release build first, then reproduced far faster on the
`--debug --apk` build.

### It is not a crash, and the app is not dead

| Checked | Result |
|---|---|
| JS exception | none, ever — `Runtime.exceptionThrown` and `Log.entryAdded` both silent |
| Console errors | none |
| Renderer crash | no `Inspector.targetCrashed`; renderer process alive in `ps` |
| `window.__venticBoot` | `{version: "0.6.1", errors: [], missing: []}` — clean |
| OOM / LMK kill | no lmkd activity at kill time |
| **The Rust side** | **`curl` to the engine returned HTTP 200 in 16 ms while the page was dead** |

That last row is the important one. With the page completely unresponsive,
`adb forward tcp:3030` + `curl 'http://127.0.0.1:3030/torrents?with_stats=true'`
answered **200 in 16 ms**. librqbit, tokio and the whole Rust half are healthy
throughout. Whatever is stuck is on the WebView side.

### The renderer main thread is blocked in *native* code

This is the single most diagnostic measurement of the session, and it needs
doing in the right order or it lies to you:

```
Debugger.enable          BEFORE the freeze   (arms V8's interrupt)
… drive taps until the page stops answering …
Debugger.pause           AFTER it wedges
→ no Debugger.paused event in 25 s
```

V8 checks for interrupts inside loops, so **an infinite JS loop would have
paused**. It did not. Combined with `CrRendererMain` sitting at **0.0 % CPU**
across six consecutive samples, the renderer main thread is *blocked*, not
spinning — parked in a synchronous native call.

> Doing this in the wrong order is worthless and cost an hour: if you send
> `Debugger.enable` *after* the wedge it is never acked either, and you learn
> nothing. Arm it first.

Meanwhile the app's own Android main thread is **not** idle:

```
app main thread   12–18 % CPU, sustained, forever   (idle before the wedge: ~0 %)
Chrome_IOThread   2–3 %
syscall           22 = epoll_pwait   (looper churning, not blocked)
```

So: renderer main thread parked in native code, browser/UI thread busy. That
shape is a renderer↔browser deadlock.

### The last thing that happens is always the same fetch

Hooking `window.fetch` from CDP before the freeze, every run ends the same way —
the 2-second downloads poll goes out and never comes back, and then the interval
stops firing at all (the JS event loop is gone):

```
16:59:28.752 F> 127.0.0.1:3030/torrents?with_stats=true
16:59:28.761 F< 127.0.0.1:3030/torrents?with_stats=true
16:59:30.755 F> 127.0.0.1:3030/torrents?with_stats=true   ← never returns
16:59:35.808 >>> WEDGED
```

**Do not over-read this.** The poll is simply the only thing running every 2 s,
so it is always the last event before any freeze. It is a timestamp, not
necessarily a cause. The engine was answering `curl` fine at that moment.

### Rendering, when it wedges

Two different pathologies were seen, both on the release build:

| State | Frames | Janky | GPU/frame |
|---|---|---|---|
| Healthy, idle Home | 29 in 8 s | 0 % | 4 ms |
| Wedged (runaway) | continuous | **99.4 %** | **21 ms** |
| Wedged (later) | **0** | — | — |

With `RenderThread` at 65–68 %, `VizWebView` at 18–22 % and `mali-cmar-backe` at
21–27 %. `Number High input latency: 12288`.

### Ruled out for Phase 1

| Hypothesis | How it was killed |
|---|---|
| **GPU / blur / compositing** | Injected `transition:none; animation:none; backdrop-filter:none; filter:none; will-change:auto; content-visibility:visible` on `*` — **wedged at the identical tap** |
| `content-visibility: auto` alone | control and knockout both wedged at tap 2 |
| A specific page | Movies-only wedged at tap 0; Library-only at tap 2 |
| Interaction at all | one run found the page **already dead before the first tap** |
| A leak | threads flat 88→91, fds flat 302→306 across the whole run |
| The 4.3 GB in the issue | see below — not Ventic |
| `themeFromArt` / `sourceFromImage` | defaults to `false`, and the canvas is 64×64 software (`willReadFrequently`) |
| A version regression | v0.5.0 also wedged — **but that test was invalid**, see below |

The compositing knockout is worth emphasising because `layers.css` and
`reduceEffects` make it such an attractive theory (`reduceEffects` defaults to
`isTv() ?? false`, so a mid-range *phone* gets the full frosted chrome). It is
not the cause. Turning every effect off changed nothing at all.

### The 4.3 GB in issue #30 is a red herring

On this phone, with the release build installed and used:

```
app 109.6 MB   data 5.9 MB   cache 1.5 MB
```

For scale, Chrome on the same device holds 3.03 GB of data. Nothing in Ventic
writes gigabytes. Whatever the reporter's Samsung was showing, it was not
Ventic's data, and chasing it is wasted effort.

---

## Phase 2 — the process that refuses to die

### 1. Something force-stops the app

Eleven times in the user's own session between 19:44 and 20:40, always 20–80 s
after launch, with no `am_proc_died` to follow:

```
am_kill: [0,11548,com.ventic.app,0,stop com.ventic.app due to from process:11823]
```

Running `adb shell am force-stop com.ventic.app` produces a byte-identical line,
so this is a `forceStopPackage()` call — MIUI's app killer. The app is
`not whitelisted (subject to doze)`.

The pid in `from process:NNNN` is the *caller's* short-lived pid, which is why it
never appears in `am_proc_start` and cannot be traced back to a package.

### 2. 83 of 85 threads exit in ~120 ms. One never does.

Sampled repeatedly across the whole teardown window, always identical:

```
Z  wchan=0  com.ventic.app     <- thread-group leader, zombie
R  wchan=0  JavaBridge
```

The `JavaBridge` thread:

```
state=R  utime=3  stime=1772 → 2291 over 5 s   (+104 ticks/s = a full core, in kernel)
SigPnd:  0000000000000100                      <- SIGKILL pending, undelivered
ShdPnd:  0000000000000100
```

`utime` frozen at 3 while `stime` climbs at 100 % of a core: it is spinning
**inside the kernel**, with SIGKILL already queued against it. `syscall` and
`stack` are both denied to `shell`, so the exact kernel function is unknown —
that needs root.

A thread group is only reaped once *every* thread exits, so the process stays an
unreapable zombie for as long as this thread spins.

### 3. Measured at 100–150 s, three times

Also visible from the other side — the window is not released until the process
actually goes:

```
21:03:49.929  am_kill …                       <- killed
21:05:37.435  [SF client] REMOVE … for (27985:com.ventic.app)   <- 107 s later
```

### 4. Android gives up after 2 s and cancels the launch

`ActivityManagerService.handleProcessStartOrKillTimeoutLocked`, 15 occurrences in
the device's dropbox from the user's session alone:

```
ProcessRecord{5f02d0a 0:com.ventic.app/u0a1233} 11548 refused to die while
trying to launch ProcessRecord{5d21157 …}, cancelling the process start
```

The other session saw the same line three separate times on the **release**
build, so this is not a debug-build artefact.

User-visible cost, measured:

```
$ adb shell am start -W -n com.ventic.app/.MainActivity
Status: ok
WaitTime: 152577          <- 2.5 minutes
```

Tapping the icon shows a splash screen and then nothing.

### Ruled out for Phase 2

| Hypothesis | Result |
|---|---|
| The page / JS | 736 nodes, 13.6 MB heap, `window.__venticBoot` clean, no exceptions |
| Page content, images, GPU load | **Hangs identically after navigating to `about:blank`** |
| The renderer dying first | Every webview kill is `isolated not needed`, logged **6 ms after** the app kill — consequence, not cause |
| devtools / CDP attached | Hangs with nothing attached |
| Memory pressure at kill time | RSS ~370 MB, PSS ~210 MB, no LMK activity |

**Age-dependent, and the threshold is not explained.** Killed 5 s or 20 s after
launch → dies in ~1 s. Killed 40 s+ after launch → hangs 100 s+. Nothing was
found that changes in between. Even the ~1 s case is already half of AMS's 2 s
budget.

### The control — and its hole

Same device, same `am force-stop`, same 40 s after launch:

```
com.miui.securitycenter   rss=613540 kB   death <100 ms
com.ventic.app            rss=370284 kB   death 100–150 s
```

A **613 MB** process was reaped instantly. So this is **not** a device-wide
kernel bug and **not** a function of how big our process is.

**The hole:** `securitycenter` is a MIUI system app — no WebView, different
priority, possibly special-cased. The Chromium control (`com.android.chrome`)
failed to start (`no pid`) and was never re-run. **That is the missing
experiment**: it is what separates *"any WebView app on this device"* from
*"Ventic specifically"*.

---

## Where the lead points, and how the two phases corroborate each other

`JavaBridge` is Chromium's `@JavascriptInterface` dispatch thread. It exists only
because of these two lines — a WebView with no JS interfaces never spawns it:

```kotlin
// MainActivity.kt:148
webView.addJavascriptInterface(Screen(), "VenticScreen")
player = VenticPlayer(this).also { webView.addJavascriptInterface(it, "VenticPlayer") }
```

Both are `inner class` instances holding a reference to the Activity. Every
method on both was read: they are all trivial or `onMain { }`-posted, so nothing
*blocks* in our code. But the thread that will not die is the one those two
objects create.

**The independent corroboration:** `simpleperf` on the *wedged* app process
(Phase 1, before any kill) came back JNI-dominated:

```
art_jni_trampoline
art::StackVisitor::WalkStack<…>
art::(anonymous namespace)::ScopedCheck::Check(…)     <- CheckJNI, debug builds
art::StringFactory_newStringFromBytes(…)
java.net.URL.<init>
libcore.io.ForwardingOs.poll
```

Two sessions, two different faults, two different tools — both landing on the
JNI bridge. That is the strongest signal in this document. It is also why the
debug build freezes ~30× faster: CheckJNI makes every one of those hops
dramatically more expensive.

`java.net.URL.<init>` + `newStringFromBytes` is the shape of
`shouldInterceptRequest` marshalling a `WebResourceRequest` across JNI — i.e.
**every resource the page loads goes through a JNI hop into Rust**. On the dev
build that path is also the dev-server proxy; on `--debug --apk` it is the
embedded asset handler. Both freeze.

---

## Repro

### Phase 1 — the freeze (needs a debuggable build)

```bash
bunx tauri android build --debug --apk --target aarch64
adb uninstall com.ventic.app && adb install -r \
  src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n com.ventic.app/.MainActivity

# devtools socket is named after the app pid
PID=$(adb shell "ps -A -o PID,NAME|grep ' com.ventic.app'|awk '{print \$1}'" | tr -d '\r')
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
curl -s http://127.0.0.1:9222/json/list        # → webSocketDebuggerUrl

# then over CDP: Debugger.enable, tap the bottom nav a few times
# (x = 324/540/756/108/972 at y = 2142 on a 1080x2400 screen),
# evaluate `1` after each tap — it stops answering within 1–3 taps.
```

### Phase 2 — the zombie (no root, no devtools)

```bash
adb shell am start -n com.ventic.app/.MainActivity
sleep 40                                    # under ~20 s it dies normally
adb shell am force-stop com.ventic.app

P=$(adb shell pidof com.ventic.app)         # empty; use the pid from before
adb shell "ls /proc/$P/task"                # 2 left: leader (Z) + JavaBridge (R)
adb shell "grep -E 'SigPnd|ShdPnd' /proc/$P/task/<javabridge-tid>/status"
adb logcat -b events -d | grep -E 'am_kill.*ventic|refused to die'
adb shell am start -W -n com.ventic.app/.MainActivity   # watch WaitTime
```

---

## Next, in order

1. **Chromium control.** Force-stop Chrome 40 s after launch on the same device
   class. Decides whether Phase 2 is ours or WebView's. One command, do it first.
2. **Drop the JS interfaces and re-test Phase 1.** Comment out both
   `addJavascriptInterface` calls (`MainActivity.kt:148`), build `--debug --apk`,
   and run the Phase 1 repro. The app loses the `VenticScreen`/`VenticPlayer`
   bridge — most of it will not work — but if the freeze goes away, that is the
   answer to *both* phases and it is one recompile. **This is the cheapest test
   with the highest information, and it was never run.**
3. **Release build, Phase 1, properly instrumented.** The release numbers here
   (~90 s, 99.4 % janky, `refused to die` ×3) came from black-box measurement
   because release has no devtools. A release build with only the `devtools`
   Cargo feature enabled would let the V8-interrupt test run on the real thing.
4. **`System.exit()` vs `Process.killProcess()`.** `MainActivity.onDestroy`
   (`MainActivity.kt:161`) SIGKILLs the process on every clean exit, so the app
   rolls the Phase 2 dice itself whenever it is genuinely finishing. It is
   load-bearing — wry only gets one `run()` per process, which is why it is there
   — so this is an experiment, not a deletion.
5. **Bisect the 20 s → 40 s threshold.** Kill at 25/30/35 s to find where the
   spin starts, then work out what the process does at that moment.
6. **Root, if a rooted device is available.** `/proc/<tid>/stack` and `dmesg`
   name the kernel function in one read and end the guessing.
7. **A second device.** Everything here is one Redmi Note 10S. The issue reporter
   has a Samsung A54 (Exynos 1380, Mali-G68) with the same symptom, so it is not
   MIUI-only — but nothing has been measured anywhere else.

---

## Open questions

- **Is Phase 2 always preceded by Phase 1?** Phase 2 reproduces from a plain
  `am force-stop` on a *healthy* app 40 s after launch, with no freeze first — so
  the two are at least separable. Whether a real user ever hits Phase 2 without
  Phase 1 is unknown.
- **Is Phase 1 old?** v0.5.0 wedged too, but that run is **invalid**: v0.5.0 has
  no bottom nav (`AppNav` did not exist), so the scripted taps at y=2142 landed on
  page content, not nav buttons. A proper version bisect needs per-version tap
  targets. Note the issue reporter also saw a black screen on 0.5.5, which is
  weak evidence the fault predates 0.6.x.
- **Why 90 s on release but 1–3 taps on debug?** CheckJNI and the unoptimised
  Rust are the obvious explanation, but it was never confirmed.

---

## Traps found the hard way

- **`bun run tauri:dev:android` results are not admissible.** The dev server log
  showed `[Unhandled rejection] TypeError: Failed to fetch dynamically imported
  module: http://tauri.localhost/_nuxt/@fs/…/entry.js` — the known dev-proxy chunk
  failure (see the `android-dev-chunk-failure` memory). It produces its own
  freeze. Use `--debug --apk`, which embeds the production bundle.
- **Checking out an old tag runs `bun install` and leaves `node_modules` on that
  version.** Coming back to `main` then fails with `could not determine
  executable to run for package tauri`. Re-run `bun install` after every
  checkout, both directions.
- **`--single-process` will not help.** Writing `_ --single-process` to
  `/data/local/tmp/webview-command-line` is read by a debuggable app, but WebView
  still logs `multiprocess=true` on Android 13 — you cannot pull the renderer
  into the app process to inspect it.
- **`Debugger.pause` after the wedge tells you nothing** unless `Debugger.enable`
  was acked beforehand. See Phase 1.
- **The devtools socket is `webview_devtools_remote_<app pid>`.** Deriving it from
  the pid is reliable; grepping `/proc/net/unix` races the app start and picks up
  stale sockets from previous runs.
- **`adb exec-out screencap` is the ground truth**, not `Page.captureScreenshot`.

## Left on the phone

The borrowed device went home with a **debug-signed** Ventic installed and no
release copy. If it ever comes back: a release APK will not install over it
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), so `adb uninstall com.ventic.app` first —
see the `android-dev-targets` memory. `adb shell svc power stayon usb` was also
left enabled.

## Unrelated bug found on the way

`RustWebViewClient` (`src-tauri/gen/android/app/src/main/java/com/ventic/app/generated/RustWebViewClient.kt`)
has no `onRenderProcessGone` override. When Android kills the renderer — routine
on 4 GB devices — the documented default is that the **app** is killed. Nothing
to do with either phase above, but real, and cheap to fix.
