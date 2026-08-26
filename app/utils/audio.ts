/**
 * Evening out a film's volume, and lifting the dialogue out of the effects.
 *
 * The complaint this answers is the oldest one in home cinema: the whispering
 * is inaudible and the explosion wakes the house, so the remote's volume key
 * becomes a second job. A film is mixed for a room with no neighbours and a
 * 20 dB noise floor, and nothing on the way to a television undoes that.
 *
 * Two knobs, because they are two different problems:
 *
 *   - **The leveller** rides the gain over a sliding window — quiet passages
 *     come up, loud ones are held down. ffmpeg's `dynaudnorm`, which is the
 *     same class of thing as PotPlayer's "normalizer" and a receiver's night
 *     mode. It works on *whole* loudness, so it can't tell speech from a jet.
 *   - **The dialogue boost** can, when the mix says where speech is: 5.1 and
 *     7.1 put it on its own centre channel, so lifting that one channel is
 *     exactly the fix and touches nothing else. A stereo track has no such
 *     channel and only frequency is left to go on, so there it is a wide bell
 *     around 2 kHz — cruder, and it lifts anything else living up there too.
 *
 * Codec makes no difference to either: mpv, ExoPlayer and the webview all
 * decode to PCM before anything here sees it, so Dolby, DTS and TrueHD are all
 * just samples by then. The one arrangement neither can touch is a bitstream
 * handed *untouched* to a receiver over HDMI — Android does that with Dolby
 * where it can, and there is no PCM in this process to filter. It stays a
 * no-op rather than an error; the amplifier has its own night mode.
 */

/** How hard the leveller works. Off is the default: nobody's mix is altered unasked. */
export type Leveller = 'off' | 'light' | 'medium' | 'strong'

export interface AudioSettings {
  normalize: Leveller
  /** Decibels added to dialogue. 0 is off, and 8 is as far as this goes. */
  dialogue: number
}

export const AUDIO_DEFAULTS: AudioSettings = { normalize: 'off', dialogue: 0 }

/** As far as the boost goes. Past this the mix stops sounding like one. */
export const MAX_DIALOGUE = 8

/**
 * The steps, in the order both places list them: the settings page and the
 * player's own Audio panel, which edits the very same setting while a film is
 * up. `title` is a function for the reason every options table in the app has
 * one — this is built when the module loads, before `$t` has a locale.
 */
export const LEVELLERS: { value: Leveller, title: () => string }[] = [
  { value: 'off', title: () => $t('Off') },
  { value: 'light', title: () => $t('Light') },
  { value: 'medium', title: () => $t('Medium') },
  { value: 'strong', title: () => $t('Strong') },
]

/**
 * `dynaudnorm` settings per step, as ffmpeg spells them: `f` frame in ms, `g`
 * the odd number of frames it smooths the gain over, `p` the peak it aims for,
 * `m` the most it will ever amplify by, `r` a target RMS (0 = go by peak
 * alone), `s` a compressor ahead of it.
 *
 * The steps are window and ceiling together: *light* is a long, slow hand that
 * only catches a scene-length imbalance, *strong* is a short window with real
 * compression under it, which is the one that makes a night-time film work and
 * the one that will audibly pump on music.
 */
const LEVELLER: Record<Exclude<Leveller, 'off'>, string> = {
  light: 'f=500:g=31:p=0.9:m=4',
  medium: 'f=400:g=25:p=0.9:m=8:r=0.4:s=6',
  strong: 'f=250:g=15:p=0.95:m=16:r=0.7:s=12',
}

const gain = (db: number) => Math.round(10 ** (db / 20) * 100) / 100

/**
 * Lift the centre channel and leave every other one alone.
 *
 * `pan` names its output layout, and it refuses to run if a channel it is
 * asked for isn't in the input — which is why the layout mpv reported is
 * echoed back rather than a guess at it: "5.1" and "5.1(side)" both have six
 * channels and disagree about the names of two of them. Gains go by index for
 * the same reason. Index 2 is the centre in every layout ffmpeg has that owns
 * one, so only the count has to be checked.
 *
 * Nothing limits the result. Dialogue is mixed a long way below full scale and
 * effects are what peak, so a few dB on the centre alone has headroom to spend;
 * the leveller's own `p` catches it for anyone running both.
 */
function centreBoost(layout: string, channels: number, db: number) {
  const map = Array.from({ length: channels }, (_, i) => `c${i}=${i === 2 ? `${gain(db)}*` : ''}c${i}`)
  return `pan=${layout}|${map.join('|')}`
}

/** Speech without a channel of its own: one wide bell over the band it lives in. */
const speechBoost = (db: number) => `equalizer=f=2000:t=o:w=2:g=${db}`

/**
 * The whole chain as one `af` value, or '' for "no filters at all".
 *
 * `layout`/`channels` are mpv's `audio-params/channels` and
 * `audio-params/channel-count` for the track *currently playing* — a film with
 * a 5.1 track and a stereo commentary needs a different filter for each, so
 * this is rebuilt whenever the track changes. Without them (nothing playing
 * yet, or mpv wouldn't say) it falls back to the layout-independent chain,
 * which is also what a failed `af set` is retried with.
 */
export function mpvAudioChain(a: AudioSettings, layout = '', channels = 0): string {
  const parts: string[] = []
  // Dialogue first: the leveller should be reacting to the mix that will be
  // heard, not to the one before the centre channel came up.
  if (a.dialogue > 0)
    parts.push(layout && channels >= 6 ? centreBoost(layout, channels, a.dialogue) : speechBoost(a.dialogue))
  if (a.normalize !== 'off')
    parts.push(`dynaudnorm=${LEVELLER[a.normalize]}`)
  // One lavfi filter holding a graph, rather than one mpv filter each: the
  // brackets are what let a comma and a pipe through mpv's own option parser.
  return parts.length ? `lavfi=[${parts.join(',')}]` : ''
}

/**
 * What one film plays with: its own settings where it was given any, and the
 * default everything else uses where it wasn't.
 *
 * The two are edited in two places on purpose. *Settings → Audio* sets the
 * default, which is the answer to "films are mixed too quietly for this room".
 * The player's own panel sets this one, which is the answer to "I can't hear a
 * word of *this* film" — a mix that bad is one film in twenty, and levelling
 * every film after it because of one would be its own complaint.
 *
 * Keyed by `titleKey`, so a series keeps one answer across its episodes: the
 * mix is the show's, not the episode's.
 */
export function pickAudio(byTitle: Record<string, AudioSettings>, key: string, base: AudioSettings): AudioSettings {
  return (key && byTitle[key]) || base
}

/**
 * The map with `key` set to `next` — or with it *removed*, when `next` is what
 * the default says anyway. A film only stays in here for as long as it disagrees
 * with the settings page, so putting one back by hand is also how you forget it,
 * and changing the default later still reaches every film that never argued.
 *
 * Nothing prunes it otherwise: an entry is two short strings, and a viewer with
 * a thousand of them has spent about 50 KB on knowing which films were mixed
 * badly.
 */
export function rememberAudio(byTitle: Record<string, AudioSettings>, key: string, next: AudioSettings, base: AudioSettings): Record<string, AudioSettings> {
  if (!key)
    return byTitle
  const out = { ...byTitle }
  if (next.normalize === base.normalize && next.dialogue === base.dialogue)
    delete out[key]
  else
    out[key] = { ...next }
  return out
}

/**
 * The same two settings as properties, for the backends that aren't mpv.
 *
 * ExoPlayer has no filter graph: it has the platform's audio effects, which
 * attach to a session and are configured by number (see `setProp` in
 * Player.kt). So the *setting* crosses the bridge rather than the filter, and
 * Kotlin decides what to do with it — the same division as `sub-add`, where
 * each backend is told what is wanted rather than how mpv would do it.
 *
 * Names outside mpv's own set on purpose: these reach the shim in
 * htmlvideo.ts, which forwards any `set_property` it doesn't handle itself.
 */
export function audioProps(a: AudioSettings): Record<string, string | number> {
  return {
    'audio-normalize': a.normalize,
    'dialogue-boost': a.dialogue,
  }
}
