/**
 * Everything a download needs to be watched with no network, fetched as the
 * download starts — the one moment the network is certainly there. (Android
 * freezes the page in the background while a download finishes, and the plane
 * has taken off by the time it has.)
 *
 * - The title's TMDB pages and pictures, which `tmdb` and `posterUrl` fall back
 *   on: the title, its season and the episode open with nothing to ask.
 * - Subtitles in the language "choose automatically" picks, chosen the way the
 *   player chooses — free first, then the keyed provider with the most to spare
 *   (see `probeLanguage`) — and filed under the episode (`keepSubtitle`), which
 *   is where the player looks before it searches at all.
 *
 * One at a time: a season is a dozen of these, and every provider has a rate.
 */
import type { SubtitleSearch } from './subtitles'
import type { MediaDetail } from './tmdb'
import { parseKey } from './library'
import { keepImage } from './shelf'
import { byLanguage, findSubtitles, keepSubtitle, keptSubtitle, langName, probe, probeLanguage } from './subtitles'
import { fetchDetail, tmdb, tmdbImage } from './tmdb'

export interface OfflineJob {
  /** The progress key the download is filed under: `movie:603`, `tv:1396:2:3`. */
  key: string
  /** The release's name, which the subtitles are matched against. */
  release?: string
  /** Absent when there is no language to fetch subtitles in. */
  subtitles?: SubtitleSearch & { lang: string }
}

let queue: Promise<unknown> = Promise.resolve()

/** The title's details once they are kept, for the library's snapshot; null when TMDB couldn't be asked. */
export function prepareOffline(job: OfflineJob): Promise<MediaDetail | null> {
  const run = queue.then(() => prepare(job))
  queue = run.catch(() => null)
  return run
}

async function prepare({ key, release = '', subtitles }: OfflineJob) {
  const { type, id, season, episode } = parseKey(key)
  // `tmdb` keeps each of these pages itself: the title is filed as a download
  // by now (see `keeps` in the downloads store).
  const detail = await fetchDetail(type, id).catch(() => null)
  const pictures: [string | null | undefined, string][] = [[detail?.poster, 'w342'], [detail?.backdrop, 'w1280'], [detail?.logo, 'w500']]
  if (season && episode) {
    const [, ep] = await Promise.all([
      tmdb(`/tv/${id}/season/${season}`).catch(() => null),
      tmdb<{ still_path?: string | null }>(`/tv/${id}/season/${season}/episode/${episode}`).catch(() => null),
    ])
    pictures.push([ep?.still_path, 'w300'])
  }
  await Promise.all(pictures.map(([path, size]) => path && keepImage(path, tmdbImage(path, size))))

  if (subtitles && !(await keptSubtitle(key)))
    await fetchSubtitles(key, detail?.imdbId ?? '', season, episode, release, { ...subtitles, tmdbId: id, title: detail?.title, year: detail?.year })
  return detail
}

/**
 * Subtitles for one download; true once one is kept. A few files are tried,
 * not one — a dead link or a spent quota shouldn't end it — and not more,
 * which would spend a day's downloads on one episode.
 */
export async function fetchSubtitles(key: string, imdbId: string, season: number, episode: number, release: string, by: SubtitleSearch & { lang: string }) {
  const found = await findSubtitles(imdbId, season, episode, release, by).catch(() => [])
  const lang = byLanguage(found).find(l => l.name === langName(by.lang))
  if (!lang)
    return false
  for (const file of (await probeLanguage(lang, 0, 3)).slice(0, 3)) {
    const read = await probe(file)
    if (read.cues.length) {
      await keepSubtitle(key, read)
      return true
    }
  }
  return false
}
