/**
 * Why a white screen is never an acceptable failure.
 *
 * The app is one ES module built for Chrome 111 (Vite's default `build.target`,
 * and Vuetify calls `Array.prototype.toSorted` besides). A webview older than
 * that cannot parse it, and a script that never parses paints nothing — so what
 * is left on screen is the activity window behind a transparent webview, and
 * "it opens to a white screen" is the entire bug report anyone can give us.
 *
 * This is inlined into the document head ahead of the bundle, in the oldest
 * JavaScript there is, so that it still runs on the webview that couldn't run
 * the app. It turns that white screen into one you can photograph: the webview's
 * version, which of the features the bundle needs are missing, and whatever was
 * actually thrown.
 *
 * It only takes the screen when nothing mounted. Once Nuxt is up, Nuxt's own
 * error page says more than this could, so errors are only collected onto
 * `window.__venticBoot` — which is also how to read them over adb or devtools,
 * along with `__venticBoot.show()` to raise the panel by hand.
 */
;(function () {
  // Head tags survive hydration, but a second copy would cost nothing to guard.
  if (window.__venticBoot)
    return

  var VERSION = '__VERSION__'
  var NEEDS = 111

  var boot = window.__venticBoot = {
    version: VERSION,
    errors: [],
    missing: [],
    show: show,
    report: report,
  }

  /**
   * What the bundle assumes, and the Chrome that first shipped it. Syntax is
   * tested through `new Function` because a webview that can't parse a feature
   * throws where it is *written*, not where it runs — which is exactly why the
   * app dies silently and this file can't use any of it.
   */
  function syntax(src) {
    try {
      new Function(src)
      return true
    }
    catch (e) {
      return false
    }
  }

  var CHECKS = [
    ['optional chaining', 80, function () { return syntax('a?.b') }],
    ['logical assignment', 85, function () { return syntax('var a; a ??= 1') }],
    ['Array.at', 92, function () { return !![].at }],
    ['Object.hasOwn', 93, function () { return !!Object.hasOwn }],
    ['Array.findLast', 97, function () { return !![].findLast }],
    ['structuredClone', 98, function () { return typeof structuredClone === 'function' }],
    ['CSS @layer', 99, function () { return typeof CSSLayerBlockRule !== 'undefined' }],
    ['AbortSignal.timeout', 103, function () { return !!(window.AbortSignal && AbortSignal.timeout) }],
    ['CSS :has()', 105, function () { return !!(window.CSS && CSS.supports && CSS.supports('selector(:has(*))')) }],
    ['Array.toSorted', 110, function () { return !![].toSorted }],
  ]

  for (var i = 0; i < CHECKS.length; i++) {
    var ok = false
    try {
      ok = CHECKS[i][2]()
    }
    catch (e) {}
    if (!ok)
      boot.missing.push(CHECKS[i][0] + ' (Chrome ' + CHECKS[i][1] + ')')
  }

  function chromeVersion() {
    var m = /Chrome\/(\d+)/.exec(navigator.userAgent)
    return m ? Number(m[1]) : 0
  }

  function attempt(fn) {
    try {
      return String(fn())
    }
    catch (e) {
      return 'error'
    }
  }

  function environment() {
    var bridge = window.VenticScreen
    return [
      ['Ventic', VERSION],
      ['Webview', chromeVersion() ? 'Chrome ' + chromeVersion() : 'unknown'],
      ['User agent', navigator.userAgent],
      ['Page', String(location.href)],
      ['Screen', screen.width + '×' + screen.height + ' @' + (window.devicePixelRatio || 1)
        + ', viewport ' + window.innerWidth + '×' + window.innerHeight],
      ['Android bridge', bridge ? 'yes, tv=' + attempt(function () { return bridge.tv() }) : 'no'],
      ['Storage', attempt(function () {
        localStorage.setItem('ventic.boot', '1')
        localStorage.removeItem('ventic.boot')
        return 'ok'
      })],
      ['Network', navigator.onLine ? 'online' : 'offline'],
      ['Missing features', boot.missing.length ? boot.missing.join(', ') : 'none'],
    ]
  }

  /**
   * The one sentence worth reading from across a room. An old webview is the
   * likely answer and the only one the user can act on, so it gets said plainly;
   * anything else falls back to whatever was thrown.
   */
  function verdict() {
    var v = chromeVersion()
    if (v && v < NEEDS) {
      return 'This device\'s Android System WebView is Chrome ' + v + '. Ventic needs '
        + NEEDS + ' or newer. Update "Android System WebView" (and Chrome) from the '
        + 'Play Store, then reopen Ventic.'
    }
    if (boot.missing.length)
      return 'This webview is missing features Ventic is built with: ' + boot.missing.join(', ') + '.'
    if (boot.errors.length)
      return 'The app failed to start. The error below is what stopped it.'
    return 'The app never finished starting, and nothing reported an error. The details below are all we have.'
  }

  function record(kind, message, where) {
    boot.errors.push({ kind: kind, message: String(message), where: where || '' })
    setTimeout(check, 1200)
  }

  // Capture phase, because a <script> or stylesheet that fails to load fires its
  // error at the element and never reaches window in the bubble phase — and a
  // chunk that didn't arrive looks exactly like one that didn't parse.
  window.addEventListener('error', function (e) {
    if (e && e.message) {
      var at = (e.filename || '') + (e.lineno ? ':' + e.lineno + ':' + e.colno : '')
      var stack = e.error && e.error.stack ? String(e.error.stack).split('\n').slice(0, 4).join('\n') : ''
      record('error', e.message, at + (stack ? '\n' + stack : ''))
    }
    else if (e && e.target && (e.target.src || e.target.href)) {
      record('load', 'Failed to load ' + (e.target.src || e.target.href))
    }
  }, true)

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason
    record('promise', (r && (r.message || r)) || 'unhandled rejection', r && r.stack ? String(r.stack).split('\n').slice(0, 4).join('\n') : '')
  })

  function mounted() {
    var root = document.getElementById('__nuxt')
    return !!(root && root.firstChild)
  }

  function report() {
    var lines = ['Ventic failed to start', '', verdict(), '']
    var env = environment()
    for (var i = 0; i < env.length; i++)
      lines.push(env[i][0] + ': ' + env[i][1])
    for (var j = 0; j < boot.errors.length; j++) {
      var e = boot.errors[j]
      lines.push('', '[' + e.kind + '] ' + e.message, e.where)
    }
    return lines.join('\n')
  }

  function escape(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  var panel = null

  function show() {
    if (panel || !document.body) {
      if (!panel)
        setTimeout(show, 200)
      return
    }

    var html = '<h1 style="margin:0 0 12px;font-size:22px;color:#fff">Ventic couldn\'t start</h1>'
      + '<p style="margin:0 0 20px;font-size:17px;line-height:1.5;color:#ffd280">' + escape(verdict()) + '</p>'

    var env = environment()
    html += '<table style="border-collapse:collapse;width:100%">'
    for (var i = 0; i < env.length; i++) {
      html += '<tr><td style="padding:2px 12px 2px 0;color:#8a8a8a;white-space:nowrap;vertical-align:top">'
        + escape(env[i][0]) + '</td><td style="padding:2px 0;word-break:break-all">'
        + escape(env[i][1]) + '</td></tr>'
    }
    html += '</table>'

    for (var j = 0; j < boot.errors.length; j++) {
      var e = boot.errors[j]
      html += '<pre style="margin:16px 0 0;padding:10px;background:#000;border-left:3px solid #c33;'
        + 'white-space:pre-wrap;word-break:break-all;color:#ff9a9a">' + escape(e.message)
        + (e.where ? '\n<span style="color:#8a8a8a">' + escape(e.where) + '</span>' : '') + '</pre>'
    }

    html += '<p style="margin:20px 0 0;color:#8a8a8a">Please photograph this screen and add it to '
      + 'github.com/ventic/ventic/issues</p>'

    panel = document.createElement('div')
    panel.id = 'ventic-boot-error'
    panel.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;'
      + 'overflow:auto;background:#101010;color:#e6e6e6;padding:24px;'
      + 'font:14px/1.45 monospace;text-align:left;-webkit-text-size-adjust:none')
    panel.innerHTML = html
    document.body.appendChild(panel)

    // There is no pointer on a television and no d-pad handler either — that
    // ships in the bundle that just failed — so the arrows have to scroll this
    // by hand or the bottom of it is unreachable.
    document.addEventListener('keydown', function (event) {
      var step = event.keyCode === 40 ? 80 : event.keyCode === 38 ? -80 : 0
      if (step && panel) {
        panel.scrollTop += step
        event.preventDefault()
      }
    })
  }

  function hide() {
    if (panel && panel.parentNode) {
      panel.parentNode.removeChild(panel)
      panel = null
    }
  }

  /**
   * Mounted wins, always. A weak box can take its time over 1.4 MB of
   * JavaScript, and an error early in boot doesn't always stop the app — so this
   * keeps looking rather than deciding once, and takes the panel back down if
   * the app turns up late.
   */
  function check() {
    if (mounted())
      hide()
    else
      show()
  }

  setTimeout(check, 12000)
  setInterval(function () {
    if (panel)
      check()
  }, 1000)
})()
