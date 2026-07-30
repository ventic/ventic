# README screenshots

The `.png` files here are placeholders. Replace each with a real capture at (or above) the size
listed — the README references them by name, so keep the filenames.

| File | Size | What to capture |
| --- | --- | --- |
| `hero.png` | 1600×900 | Home, scrolled to the top: Continue watching over the TMDB rows. The one people judge the project by. |
| `detail.png` | 1200×750 | A show's detail page with the backdrop, cast and a season expanded — enough to show per-episode watched ticks. |
| `player.png` | 1200×750 | Playback with the control bar up, ideally mid-scrub so a seek-preview frame is visible. |
| `downloads.png` | 1200×750 | Downloads with a few torrents in different states, one expanded to show file selection. |
| `themes.png` | 1200×750 | Settings → Appearance, theme grid visible. |

Capture on the desktop build at 1× scale with a dark theme, and crop out the window decorations.
`bun run tauri:dev` is fine — nothing here depends on a release build.

Nothing identifying should end up in a shot: no source URLs in `Settings → Sources`, no Trakt
username, no local file paths in the downloads list.
