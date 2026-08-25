// Self-check for the boot diagnostics panel: `bun scripts/check-boot.ts`.
// It is the one piece of the app that only ever runs when everything else has
// already failed, on a device nobody here owns — so it gets exercised in a
// stripped realm rather than trusted.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { GROUND } from '../app/theme/themes'

const SOURCE = readFileSync(new URL('../app/boot-diagnostics.js', import.meta.url), 'utf8')
  .replace('__VERSION__', '9.9.9')
  .replace('__GROUND__', GROUND)

/** Enough DOM for a panel that is one div of markup and nothing else. */
function element(tag: string) {
  const node: any = {
    tagName: tag,
    id: '',
    innerHTML: '',
    style: {} as Record<string, string>,
    scrollTop: 0,
    children: [] as any[],
    parentNode: null as any,
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) { node.attributes[name] = value },
    appendChild(child: any) {
      child.parentNode = node
      node.children.push(child)
      return child
    },
    removeChild(child: any) {
      node.children = node.children.filter((c: any) => c !== child)
      child.parentNode = null
    },
    get firstChild() { return node.children[0] ?? null },
  }
  return node
}

interface Boot {
  version: string
  errors: { kind: string, message: string, where: string }[]
  missing: string[]
  show: () => void
  report: () => string
}

interface Harness {
  boot: Boot
  panel: () => any
  /** The reassuring screen that comes long before the diagnostic one. */
  hint: () => any
  /** What `html` is painted, which is the very first thing this script does. */
  ground: () => string | undefined
  mount: () => void
  /** Run every timer whose delay has come due, oldest first. */
  advance: (ms: number) => void
  fire: (type: string, event: any) => void
  /** Head tags survive hydration, so the script can be evaluated twice. */
  rerun: () => void
}

function launch(options: {
  ua?: string
  drop?: string[]
  bridge?: boolean
  /** What the app painted last time, as it would come back off localStorage. */
  remembered?: string
  /** A webview with site data switched off throws rather than answering null. */
  noStorage?: boolean
} = {}): Harness {
  const body = element('body')
  const root = element('div')
  const html = element('html')
  html.style = {} as Record<string, string>
  root.id = '__nuxt'

  let clock = 0
  const timers: { at: number, every: number, fn: () => void }[] = []
  const listeners: Record<string, ((event: any) => void)[]> = {}

  function on(type: string, fn: (event: any) => void) {
    (listeners[type] ??= []).push(fn)
  }

  const sandbox: any = {
    setTimeout: (fn: () => void, ms: number) => timers.push({ at: clock + ms, every: 0, fn }),
    setInterval: (fn: () => void, ms: number) => timers.push({ at: clock + ms, every: ms, fn }),
    navigator: { userAgent: options.ua ?? 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Safari/537.36', onLine: true },
    location: { href: 'http://tauri.localhost/' },
    screen: { width: 1920, height: 1080 },
    devicePixelRatio: 2,
    innerWidth: 960,
    innerHeight: 540,
    localStorage: {
      setItem() {},
      removeItem() {},
      getItem(key: string) {
        if (options.noStorage)
          throw new Error('access denied')
        return key === 'ventic.ground' ? options.remembered ?? null : null
      },
    },
    structuredClone: (value: unknown) => value,
    CSS: { supports: () => true },
    CSSLayerBlockRule: class {},
    AbortSignal: { timeout: () => ({}) },
    document: {
      body,
      documentElement: html,
      getElementById: (id: string) => (id === '__nuxt' ? root : null),
      createElement: element,
      addEventListener: on,
    },
    addEventListener: on,
  }
  if (options.bridge)
    sandbox.VenticScreen = { tv: () => true }
  sandbox.window = sandbox

  const context = vm.createContext(sandbox)
  // A stripped realm is the whole point: an old webview is exactly a realm with
  // these missing, and `delete` is the only honest way to produce one.
  for (const path of options.drop ?? [])
    vm.runInContext(`delete ${path}`, context)
  vm.runInContext(SOURCE, context)

  return {
    boot: sandbox.__venticBoot,
    panel: () => body.children.find((c: any) => c.id === 'ventic-boot-error') ?? null,
    hint: () => body.children.find((c: any) => c.id === 'ventic-boot-hint') ?? null,
    ground: () => html.style.backgroundColor,
    mount: () => root.appendChild(element('div')),
    advance(ms: number) {
      const until = clock + ms
      for (let guard = 0; guard < 1000; guard++) {
        const next = timers.filter(t => t.at <= until).sort((a, b) => a.at - b.at)[0]
        if (!next)
          break
        clock = next.at
        if (next.every)
          next.at += next.every
        else
          timers.splice(timers.indexOf(next), 1)
        next.fn()
      }
      clock = until
    },
    fire(type: string, event: any) {
      for (const fn of listeners[type] ?? [])
        fn(event)
    },
    rerun: () => vm.runInContext(SOURCE, context),
  }
}

// The ordinary launch: the app mounts, and the panel is never seen.
{
  const app = launch()
  app.mount()
  app.advance(30000)
  assert.equal(app.panel(), null, 'a working app is left alone')
  assert.deepEqual(app.boot.missing, [], 'a modern realm is missing nothing')
}

// Nothing mounted and nothing thrown — the white screen this was written for.
{
  const app = launch()
  app.advance(11000)
  assert.equal(app.panel(), null, 'a slow box gets time to finish booting')
  app.advance(2000)
  assert.ok(app.panel(), 'a page that never mounts says so')
}

// The answer the reporter can act on, read straight off the user agent.
{
  const app = launch({ ua: 'Mozilla/5.0 (Linux; Android 9; MiBOX4) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/66.0.3359.158 Mobile Safari/537.36' })
  app.advance(13000)
  const html = app.panel().innerHTML
  assert.match(html, /Chrome 66/, 'the webview version is named')
  assert.match(html, /needs 111/, 'and what it would take to run')
  assert.match(app.boot.report(), /Chrome 66/, 'the same over devtools')
}

// The feature probes are what catch a webview whose user agent lies.
{
  const app = launch({ drop: ['Array.prototype.toSorted', 'Object.hasOwn', 'globalThis.structuredClone'] })
  assert.deepEqual(app.boot.missing, [
    'Object.hasOwn (Chrome 93)',
    'structuredClone (Chrome 98)',
    'Array.toSorted (Chrome 110)',
  ], 'each gap is named with the Chrome that closed it')
}

// An error before mount is the panel's real cargo.
{
  const app = launch()
  app.fire('error', { message: 'Unexpected token \'?\'', filename: 'http://tauri.localhost/_nuxt/entry.js', lineno: 1, colno: 42 })
  assert.equal(app.boot.errors.length, 1)
  app.advance(1500)
  const html = app.panel().innerHTML
  assert.match(html, /Unexpected token/, 'the message is shown')
  assert.match(html, /entry\.js:1:42/, 'and where it came from')
}

// A chunk that never arrives looks nothing like one that failed to parse, and
// only fires at the element — hence the capture-phase listener.
{
  const app = launch()
  app.fire('error', { target: { src: 'http://tauri.localhost/_nuxt/BdGLNJTE.js' } })
  assert.match(app.boot.errors[0]!.message, /Failed to load .*BdGLNJTE\.js/)
}

{
  const app = launch()
  app.fire('unhandledrejection', { reason: new Error('invoke() failed') })
  assert.match(app.boot.errors[0]!.message, /invoke\(\) failed/)
}

// The panel prints an error message straight from a page, so it escapes it.
{
  const app = launch()
  app.fire('error', { message: '<img src=x onerror=alert(1)>' })
  app.advance(1500)
  const html = app.panel().innerHTML
  assert.ok(!html.includes('<img'), 'no markup survives out of an error message')
  assert.match(html, /&lt;img/)
}

// A weak box can be slower than the timeout; mounting late takes it back down.
{
  const app = launch()
  app.advance(13000)
  assert.ok(app.panel(), 'shown while nothing is on screen')
  app.mount()
  app.advance(2000)
  assert.equal(app.panel(), null, 'and withdrawn once the app turns up')
}

// Everything a bug report needs, whether it is photographed or read over adb.
{
  const app = launch({ bridge: true })
  app.advance(13000)
  const html = app.panel().innerHTML
  for (const fact of ['9.9.9', 'Android 14', 'tauri.localhost', '1920×1080', 'tv=true', '960×540'])
    assert.ok(html.includes(fact), `the panel reports ${fact}`)
  assert.equal(app.boot.version, '9.9.9')
}

// Unhead re-applies head tags after hydration; a second copy must not reset the
// errors the first one collected, nor double up on listeners.
{
  const app = launch()
  app.fire('error', { message: 'parse error' })
  app.rerun()
  app.fire('error', { message: 'and another' })
  assert.deepEqual(app.boot.errors.map(e => e.message), ['parse error', 'and another'])
}

/* --- The ground, and the screen before the screen ------------------------- */

/** The "Starting…" line inside the hint, which is the only part that moves. */
function ticker(hint: any) {
  return hint.children[0].children[1].innerHTML as string
}

/** The wordmark's inline style, which is where its colour is decided. */
function wordmark(hint: any) {
  return hint.children[0].children[0].attributes.style as string
}

// The very first statement that runs, ahead of every feature probe: a webview
// that has just been handed a document paints something of ours rather than
// its own white. This is the half of the fix that lives in JavaScript — the
// window and the webview layers are set natively (see the cross-check below).
{
  const app = launch()
  assert.equal(app.ground(), GROUND, 'the default ground is painted at once')
}

// ...and the app's own, once it has painted one. Without this a light theme
// traded Windows' white flash for a dark one, which is no better.
{
  const app = launch({ remembered: '#eee9e9' })
  assert.equal(app.ground(), '#eee9e9', 'what the app painted last time wins')
}

// localStorage is not a property you can test for: a webview with site data
// switched off throws on access rather than answering null.
{
  const app = launch({ noStorage: true })
  assert.equal(app.ground(), GROUND, 'unreadable storage falls back rather than throwing')
  app.advance(13000)
  assert.ok(app.panel(), 'and the rest of the script still runs')
}

// A healthy boot never sees either screen, which is the whole constraint on how
// early the first one may come.
{
  const app = launch()
  app.advance(2000)
  assert.equal(app.hint(), null, 'nothing at all for the first couple of seconds')
  app.mount()
  app.advance(30000)
  assert.equal(app.hint(), null, 'and nothing ever, for an app that started')
}

// The gap this was added for: a slow phone spent twelve seconds indistinguishable
// from a dead one, and the reports said "it was real dark so I closed it".
{
  const app = launch()
  app.advance(3000)
  const hint = app.hint()
  assert.ok(hint, 'a slow start says it is a slow start')
  assert.equal(app.panel(), null, 'without claiming anything is wrong yet')
  assert.match(hint.attributes.style, new RegExp(GROUND), 'on the app\'s own ground')
}

// The ellipsis is the diagnostic, not the decoration: if it moves, the webview
// is running our code and the bundle is merely slow. A photograph of a dark
// screen cannot otherwise tell that from a webview that never ran anything.
{
  const app = launch()
  app.advance(3000)
  const first = ticker(app.hint())
  app.advance(500)
  assert.notEqual(ticker(app.hint()), first, 'the ellipsis moves')
  app.advance(2000)
  assert.match(ticker(app.hint()), /^Starting\.{0,3}$/, 'and stays within three dots')
}

// Mounted still wins over everything, including the reassuring version.
{
  const app = launch()
  app.advance(3000)
  assert.ok(app.hint(), 'shown while nothing is on screen')
  app.mount()
  app.advance(2000)
  assert.equal(app.hint(), null, 'and withdrawn the moment the app turns up')
}

// Twelve seconds in, being reassuring stops being honest.
{
  const app = launch()
  app.advance(3000)
  assert.ok(app.hint())
  app.advance(10000)
  assert.equal(app.hint(), null, 'the hint gives way')
  assert.ok(app.panel(), 'to the diagnostic that replaces it')
}

// An error skips the reassurance: there is nothing left to be reassuring about.
{
  const app = launch()
  app.advance(3000)
  assert.ok(app.hint())
  app.fire('error', { message: 'Unexpected token \'?\'' })
  app.advance(1500)
  assert.equal(app.hint(), null, 'the hint stands down')
  assert.match(app.panel().innerHTML, /Unexpected token/, 'and the error is on screen at 4s, not 12s')
}

// Two lines of white text on a pale ground is the flash all over again, so the
// hint reads its own contrast off whichever ground it ended up with.
{
  const dark = launch()
  dark.advance(3000)
  assert.match(wordmark(dark.hint()), /#ff5555/, 'the brand red on the grounds it was drawn for')

  const light = launch({ remembered: '#eee9e9' })
  light.advance(3000)
  assert.ok(!wordmark(light.hint()).includes('#ff5555'), 'and never on a light one, where it falls under 3:1')
}

/* --- One colour, four files ----------------------------------------------- */

// Three layers can each flash the wrong colour before the app paints: the native
// window, the webview, and the document. Only the last of them can import the
// theme — the other two are read by Rust and by Gradle — so this is what keeps
// all of them saying what the default theme actually says.
{
  // GROUND is cast to a string on the way out of Vuetify's palette type, so the
  // shape is worth one assert before three files are compared against it.
  assert.match(GROUND, /^#[0-9a-f]{6}$/, 'the ground is a plain six-digit hex')

  const tauri = readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
  const colors = readFileSync(
    new URL('../src-tauri/gen/android/app/src/main/res/values/colors.xml', import.meta.url),
    'utf8',
  )
  const themes = readFileSync(
    new URL('../src-tauri/gen/android/app/src/main/res/values/themes.xml', import.meta.url),
    'utf8',
  )
  const nightThemes = readFileSync(
    new URL('../src-tauri/gen/android/app/src/main/res/values-night/themes.xml', import.meta.url),
    'utf8',
  )

  assert.equal(
    JSON.parse(tauri).app.windows[0].backgroundColor,
    GROUND,
    'the desktop window and webview start on the app\'s ground — this is the Windows double white flash',
  )
  assert.match(
    colors,
    new RegExp(`<color name="ventic_ground">${GROUND}</color>`),
    'and so does the Android window',
  )
  for (const [name, file] of [['themes.xml', themes], ['values-night/themes.xml', nightThemes]] as const) {
    assert.match(
      file,
      /<item name="android:windowBackground">@color\/ventic_ground<\/item>/,
      `${name} uses it rather than the platform's colorBackground`,
    )
  }
}

// eslint-disable-next-line no-console
console.log('boot diagnostics ok')
