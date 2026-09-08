# Android: the freeze, and the process that refuses to die

**Status: cause found, reproduced on demand, fixed and verified on hardware.**
**Reported as:** "app just freezes after a while and nothing happens, it becomes
completely unresponsive — on some devices."
**Upstream:** github.com/ventic/ventic issue #30 (Samsung A54, Android 16).

Three sessions. The first two measured a borrowed Redmi Note 10S carefully and
guessed wrong about what the measurements meant. The third (2026-09-08)
reproduced the whole thing on a Pixel 8 Pro by changing **one line of our own
code**, which is what settled it.

---

## The cause, in one function

`maxFile()` in `MainActivity.kt` allocates a **4 GiB file**, on the thread that
blocks the WebView renderer, **every ten seconds**:

```kotlin
private fun maxFile(dir: java.io.File, free: Long): Long {
  if (free <= FAT32_MAX) return 0L
  val probe = java.io.File(dir, ".ventic-size-probe")
  return try {
    java.io.RandomAccessFile(probe, "rw").use { it.setLength(FAT32_MAX + 1) }  // 4,294,967,296 bytes
    0L
  } catch (e: java.io.IOException) {
    FAT32_MAX
  } finally {
    probe.delete()
  }
}
```

It answers a fair question — *can this drive hold a film bigger than FAT32's
4 GiB limit?* — and there is no way to ask it but to try. Three separate things
make trying it a disaster, and each one is sufficient on its own:

1. **It is on a ten-second timer.** `downloads.ts` re-reads free space every
   10 s and reads `volumes()` in the same tick to keep `fileLimit` current. Free
   space really does move. **A mounted volume's maximum file size does not.**
2. **It runs on the JavaBridge thread.** `@JavascriptInterface` methods are
   **synchronous**: the renderer main thread blocks on an IPC to the browser
   process until Kotlin returns. Everything `maxFile` does, the page waits for.
3. **`setLength` is only free on a filesystem with sparse files.** On ext4 and
   f2fs it is an `ftruncate` that allocates nothing. On **exFAT and FAT32 — i.e.
   any SD card** — there are no sparse files, so the kernel must allocate and
   zero four gigabytes for real.

`dormant()` is only true when the page is hidden *and* nothing is downloading, so
in the foreground this fires from the moment the app opens, on every device with
more than 4 GiB free, with no sources configured and nothing downloading. That is
the "even if it's just still" in the report.

### Why only some phones

Not the phone — the **filesystem**. The Redmi Note 10S and the Samsung A54 both
take a microSD card, which is exFAT on anything over 32 GB. The Pixel 8 Pro has
no card slot, and its storage is f2fs, where the same call is a sparse
`ftruncate`. Measured on the Pixel:

```
volumes() -> {"ms":11,...,"maxFile":0}
10x volumes() -> [5,8,9,5,5,2,1,1,1,1] ms
```

Five milliseconds to allocate and delete four gigabytes, because nothing was
allocated. That is why the app is flawless on one phone and unusable on the next.

---

## The proof

The Pixel would not reproduce anything as shipped (see *What did not reproduce*).
So `setLength` was replaced with the loop a non-sparse filesystem is forced to
perform anyway — the same 4 GiB, written for real, `fsync`ed to be media-bound
like removable flash — and nothing else was changed:

```kotlin
java.io.RandomAccessFile(probe, "rw").use { f ->
  val buf = ByteArray(1 shl 20)
  var written = 0L
  while (written < FAT32_MAX + 1) { f.write(buf); written += buf.size }
  f.fd.sync()
}
```

Every symptom in the original report appeared at once on a phone that had none of
them a minute earlier.

**The page dies, recovers for a moment, dies again** — the ten-second cycle:

```
20:00:58  Debugger.enable -> TIMEOUT (never acked)
20:01:22  PING: *** NO ANSWER (wedged) ***
20:01:27  PING: *** NO ANSWER (wedged) ***
20:01:31  PING: ok            <- between two probes
20:01:35  PING: *** NO ANSWER (wedged) ***
   … forever …
```

**The JavaBridge thread, sampled every 500 ms** — `utime` frozen at 22 while
`stime` climbs, in `D` (uninterruptible kernel I/O) and `R`, with the probe file
growing to exactly 4,294,967,296 bytes and then restarting from zero:

```
22:00:55  JavaBridge state=D utime=7  stime=124   probe=1469661184
22:01:10  JavaBridge state=R utime=13 stime=314   probe=2990133248
22:01:24  JavaBridge state=D utime=22 stime=492   probe=4294967296
22:01:32  JavaBridge state=D utime=22 stime=585   probe=4294967296
22:01:34  JavaBridge state=D utime=22 stime=649   probe=845152256   <- next cycle
22:02:04  JavaBridge state=D utime=22 stime=1156  probe=1915666432
```

Compare the Redmi, measured blind two sessions earlier: `utime=3` frozen,
`stime 1772 → 2291 over 5 s`. Same thread, same frozen user time, same climbing
kernel time. It was the same function all along.

**And the 4.3 GB.** Force-stopping the wedged app mid-probe:

```
$ ls -la …/files/.ventic-size-probe
-rw-rw---- 1 u0_a639 ext_data_rw 3662675968 …
$ du -sh /sdcard/Android/data/com.ventic.app
3.4G
```

`finally { probe.delete() }` cannot run if the process is killed inside the
write. A kill two seconds later leaves the full 4,294,967,296 bytes — **4.29 GB,
which is the "4.3 GB" issue #30 reported and the last write-up dismissed as a
red herring.** It was the single most direct piece of evidence in the whole
issue.

---

## What this corrects from the previous write-up

The measurements in it were sound. Two of its conclusions were not.

- **"The 4.3 GB is a red herring — nothing in Ventic writes gigabytes."** It is
  the probe file, to the byte. The reasoning was that the *installed* app was
  109 MB, which was true and irrelevant: the probe lands in external files, and
  only survives a kill landing inside the write.
- **The simpleperf trace does not show `shouldInterceptRequest`.** It read
  `art_jni_trampoline` / `java.net.URL.<init>` / `ForwardingOs.poll` as a
  `WebResourceRequest` being marshalled across JNI, and called it independent
  corroboration of a JNI-bridge fault. `java.net.URL(url).openConnection()` is
  `Downloads.kt:253` — the foreground service's own three-second HTTP poll of the
  engine, doing exactly its job. simpleperf profiled the whole process, and in a
  wedged process the busiest Java thread is the one that never stops. The
  agreement between the two sessions was a coincidence of two different threads.
- **The "age-dependent" 20 s → 40 s threshold is not about age.** It is whether
  a probe happens to be in flight when the kill lands. On a ten-second cycle a
  kill at 5 s or 20 s often misses one; a later one is likelier to land inside.
  Nothing changes at 40 s, which is why nothing was found that does.

`JavaBridge` being the last thread alive was right, and so was reading it as the
`@JavascriptInterface` dispatch thread. What it is stuck *in* is our own probe.

---

## What did not reproduce on the Pixel 8 Pro, unmodified

Worth recording, because it is what says the fault is the filesystem and not the
code path being rare. Device: Pixel 8 Pro (husky), Android 17 `CP2A.260805.005`,
WebView 151.0.7922.199, `--debug --apk` — the same build type that wedged the
Redmi in 1–3 taps.

| Test | Result |
|---|---|
| 12 bottom-nav taps, ping after each | no wedge |
| 5 minutes idle, ping every 15 s | no wedge |
| 6 rounds of fling-scrolling all three browse pages | no wedge, to 6428 nodes / 559 images, JS heap flat at 13 MB |
| `am force-stop` 6 min after launch | reaped in 1.4 s |
| `am force-stop` 45 s after launch (the doc's threshold) | reaped in **247 ms**; last threads were the leader (Z) and `ConscryptStatsL` — **not** `JavaBridge` |

So Phase 2's 100–150 s hang is not a MIUI bug and not a device-wide kernel bug:
it is how long the pending write takes to finish before SIGKILL can be delivered.
On UFS finishing 4 GiB is quick; on an SD card it is minutes. Same mechanism,
different media.

---

## Repro

Needs no SD card — the point of the patch is that it makes any device behave like
one. Apply the loop above to `maxFile`, then:

```bash
bunx tauri android build --debug --apk --target aarch64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n com.ventic.app/.MainActivity

PID=$(adb shell "ps -A -o PID,NAME|grep ' com.ventic.app$'|awk '{print \$1}'" | tr -d '\r')
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
curl -s http://127.0.0.1:9222/json/list        # → webSocketDebuggerUrl

# the freeze: Runtime.evaluate `1+1` twice a second — it stops answering within ~15 s
# the thread:
adb shell "while :; do for t in \$(ls /proc/$PID/task); do
  [ \"\$(cat /proc/$PID/task/\$t/comm)\" = JavaBridge ] && awk '{print \$3, \$14, \$15}' /proc/$PID/task/\$t/stat
done; stat -c %s /sdcard/Android/data/com.ventic.app/files/.ventic-size-probe 2>/dev/null; done"
# the leak:
adb shell am force-stop com.ventic.app
adb shell du -sh /sdcard/Android/data/com.ventic.app     # → gigabytes
```

**Delete the probe file and uninstall afterwards.** A debug-signed build blocks
the next release sideload — see the `android-dev-targets` memory.

Without the patch, the same repro on a phone with an **exFAT SD card** and
Ventic's download folder pointed at it should wedge as shipped. That is the one
experiment still worth running, and it needs a card.

---

## The fix

Applied in `MainActivity.kt`. The probe stays — there is genuinely no way to ask
a filesystem its maximum file size but to try one — and everything about *when*
and *where* changed.

**1. Removable drives only.** Built-in storage cannot be FAT32: Android needs
POSIX permissions, SELinux xattrs and hard links out of `/data`, and FAT has
none of them. So `volumes()` passes `volume?.isRemovable == true` through and a
phone with no card slot now never probes at all. On the Pixel, measured after
the fix: **zero `ventic-fs-probe` threads over the life of the process.**

**2. Once per drive, not once per call.** `fileLimits` caches the answer by
volume path. A mounted volume's maximum file size cannot change; only its free
space can, and that is a separate `StatFs` call that was always cheap.

**3. Never on the calling thread.** `probeFileLimit` runs on a daemon thread and
`maxFile` returns immediately. Until the probe answers it reports `0` — "no
limit" — which the caller already understands
(`drive?.maxFile || Number.POSITIVE_INFINITY`), so no frontend change was
needed. `0` is also the right guess: every filesystem but FAT32 has no limit,
and claiming an unmeasured 4 GiB cap would hide films a drive can hold.

**4. A leftover is cleared at startup.** `clearStaleProbes()` in `onCreate`
deletes `.ventic-size-probe` from every external files dir. The `finally` cannot
run through a SIGKILL, so this is the only thing that gets 4 GiB of nothing off a
phone that already has one — including the phones already out there.

The thread body is wrapped in `runCatching`: an uncaught exception on a thread of
our own would take the whole process with it, because Android's default handler
kills the app for any thread and not just the main one.

`bun run check:android-downloads` holds all four. They are invisible in review
and the failure is somebody else's phone freezing solid.

### Verified on hardware

Two builds on the Pixel 8 Pro, the same instrument that measured the fault.

**The fix under the SD-card simulation** — the probe forced on (as if internal
storage were removable) *and* made non-sparse, i.e. the exact case that wedged
the phone twenty minutes earlier:

```
22:31:06  [JavaBridge S u=2 s=0] [ventic-fs-probe D u=4 s=259] probe=2629341184
22:31:11  [JavaBridge S u=2 s=0] [ventic-fs-probe D u=7 s=427] probe=3982221312
22:31:13  [JavaBridge S u=3 s=0] [ventic-fs-probe D u=8 s=509] probe=4294967296
22:31:17  [JavaBridge S u=3 s=0]                               probe=-
22:31:55  [JavaBridge S u=3 s=0]                               probe=-
```

`JavaBridge` sits in `S` with `stime` **0** throughout, while the probe thread
does the four gigabytes. The page answered every ping at 400 ms intervals for the
whole run — before the fix it stopped answering within 15 s and never recovered.
And the probe file appears **once** and never returns: no ten-second cycle.

**The shipping build**, unmodified:

```
volumes() -> [6,8,6,2,2,2,2,3,2,2] ms, maxFile 0
ventic-fs-probe threads: 0
du -sh /sdcard/Android/data/com.ventic.app -> 7.0K
```

**And downloads still work** — a Debian netinst magnet through the engine on the
phone, 20 seconds after adding it:

```
state: live | progress: 28835840 / 406847488
peers: live 7, seen 85 | speed: 1.91 MiB/s
```

`bun run lint` clean, all 22 `bun run check` scripts pass. The test torrent was
deleted and the phone uninstalled afterwards.

### What is still true

A removable exFAT card will still pay for one 4 GiB probe, once, in the
background, the first time the app lists volumes with that card mounted. It
blocks nothing and leaves nothing behind. Making it cheaper would mean a way to
read a volume's filesystem type, which Android does not offer — SELinux denies
`/proc/filesystems` and FUSE hides the real type of a mounted volume.

---

## Traps found the hard way

- **`bun run tauri:dev:android` results are not admissible.** The dev server's
  `Failed to fetch dynamically imported module` chunk failure produces its own
  freeze (see the `android-dev-chunk-failure` memory). Use `--debug --apk`.
- **`Debugger.pause` after the wedge tells you nothing** unless `Debugger.enable`
  was acked beforehand — after it, `enable` is never acked either. Arm it first.
  (In the reproduction above, `Debugger.enable` timing out *is* the signal.)
- **A blocked renderer is not a blocked V8.** An infinite JS loop would answer
  `Debugger.pause`. Nothing answering, with `CrRendererMain` at 0.0 % CPU, means
  it is parked in a synchronous native call — which is precisely what a
  `@JavascriptInterface` call is.
- **simpleperf profiles the process, not the fault.** The busiest Java thread in
  a wedged app is whichever one has work left, and here that was the downloads
  poller. Name the thread before reading the stack.
- **The devtools socket is `webview_devtools_remote_<app pid>`.** Derive it from
  the pid; grepping `/proc/net/unix` picks up stale sockets from previous runs.
- **Checking out an old tag runs `bun install`** and leaves `node_modules` on
  that version; re-run it coming back or `tauri` is unresolvable.
- **`--single-process` will not help.** WebView still logs `multiprocess=true`.

---

## Still open

- **The unmodified repro on an exFAT SD card.** Everything above says the old
  code wedges and the new code does not; both were shown by simulating the
  filesystem rather than using one. Worth ten minutes if a card ever turns up.
- **`RustWebViewClient` has no `onRenderProcessGone` override**
  (`src-tauri/gen/android/.../generated/RustWebViewClient.kt`). When Android
  kills the renderer the documented default is that the *app* dies. Unrelated to
  this fault, still real, still cheap.
- **`interceptedState` in the same file** is an unsynchronised `mutableMapOf`
  keyed by every URL the page requests and never cleared. Tauri's code, not ours,
  and not implicated here — but it grows without bound.
