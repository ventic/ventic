//! A film streamed through a buffer instead of downloaded whole.
//!
//! The engine does the fetching and the forgetting — the `ventic:` parts of
//! vendor/librqbit, listed in its VENTIC.md. This is the policy it is handed and
//! the clock that applies it; how big the window is, and whether a film streams
//! at all, is the frontend's (`shouldStream` and `bufferWindow` in
//! app/utils/torrents.ts).
//!
//! A stream is any torrent in [`folder`]. Marked by where it lives rather than by
//! a list, so there is nothing to keep in step with the engine and nothing a crash
//! can leave half-written: whatever is still in there when the engine next starts
//! was a film nobody is watching, and [`sweep`] deletes it. A list in localStorage
//! would also have travelled in a backup — and restored on another device, it
//! would have deleted that device's own copy of the same film.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use librqbit::api::Api;

/// Bytes kept at each end of a streamed file whatever the window says: where a
/// container keeps its header and its index, which a player reads again every
/// time it reopens the file.
const EDGE: u64 = 8 * 1024 * 1024;

/// How often what the readers have left behind is forgotten. A few seconds of
/// film, so nothing a rewind would reach.
const EVERY: Duration = Duration::from_secs(3);

/// Every windowed torrent, as (id, bytes kept behind each reader). A handful at
/// most — the film playing here, or one being cast from here.
static WINDOWS: Mutex<Vec<(usize, u64)>> = Mutex::new(Vec::new());

/// Where streams are written: the app's own cache, beside the engine's default
/// folder, and never wherever downloads go. Punching the watched part back out of
/// a file needs sparse files, which a FAT32 stick doesn't have — and a film past
/// its 4 GiB limit can't even be created on one.
pub fn folder(app: &tauri::AppHandle) -> PathBuf {
	crate::cache_dir(app).join("ventic-streams")
}

#[tauri::command]
pub fn stream_folder(app: tauri::AppHandle) -> String {
	folder(&app).to_string_lossy().into_owned()
}

/// Stream torrent `id`: fetch `ahead` bytes past each reader, and keep `behind`
/// bytes behind it. No `ahead` makes it a download again — the Download button,
/// pressed on a film that was streaming.
#[tauri::command]
pub fn stream_buffer(id: usize, ahead: Option<u64>, behind: u64) -> Result<(), String> {
	let api = crate::cast::engine().ok_or("the torrent engine is not up yet")?;
	let torrent = api.mgr_handle(id.into()).map_err(|e| e.to_string())?;
	torrent.set_stream_window(ahead.unwrap_or(0)).map_err(|e| format!("{e:#}"))?;
	let mut windows = WINDOWS.lock().map_err(|e| e.to_string())?;
	windows.retain(|(other, _)| *other != id);
	if ahead.is_some() {
		windows.push((id, behind));
	}
	Ok(())
}

/// Apply every window, every few seconds, for as long as the engine runs.
pub async fn run(api: Api) {
	loop {
		tokio::time::sleep(EVERY).await;
		let windows = WINDOWS.lock().map(|w| w.clone()).unwrap_or_default();
		for (id, behind) in windows {
			match api.mgr_handle(id.into()) {
				// Paused or still starting: nothing is reading it, so nothing has moved.
				Ok(torrent) => {
					if let Some(live) = torrent.live() {
						if let Err(e) = live.forget_outside(behind, EDGE) {
							eprintln!("[ventic] stream {id}: {e:#}");
						}
					}
				}
				// Deleted — the player's way out, or the user's.
				Err(_) => {
					if let Ok(mut windows) = WINDOWS.lock() {
						windows.retain(|(other, _)| *other != id);
					}
				}
			}
		}
	}
}

/// Delete whatever a previous run left streaming, then whatever is left of its
/// files. The session brought those torrents back as ordinary downloads — the
/// window lives in memory — and nothing else would stop one filling the disk the
/// stream existed to spare. Called once the session is up, before anything plays.
pub async fn sweep(api: &Api, folder: &Path) {
	for torrent in api.api_torrent_list().torrents {
		let Some(id) = torrent.id else { continue };
		if !Path::new(&torrent.output_folder).starts_with(folder) {
			continue;
		}
		if let Err(e) = api.api_torrent_action_delete(id.into()).await {
			eprintln!("[ventic] could not delete a stream left from last time: {e:#}");
		}
	}
	let _ = std::fs::remove_dir_all(folder);
	let _ = std::fs::create_dir_all(folder);
}

#[cfg(test)]
mod tests {
	use std::io::SeekFrom;
	use std::net::Ipv4Addr;

	use librqbit::spawn_utils::BlockingSpawner;
	use librqbit::{create_torrent, AddTorrent, AddTorrentOptions, CreateTorrentOptions, ListenerOptions, Session, SessionOptions};
	use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt};
	use tokio::time::timeout;

	use super::*;

	const PIECE: u64 = 64 * 1024;
	const LEN: u64 = 256 * PIECE;

	fn scratch(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("ventic-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	/// Which pieces the engine says it has, by index.
	fn held(api: &Api, id: usize) -> Vec<bool> {
		let (bits, len) = api.api_dump_haves(id.into()).unwrap();
		(0..len as usize).map(|i| bits[i]).collect()
	}

	/// Read `len` bytes at `at`. The timeout is under a requester's 5 s nap, so a
	/// read that only lands because one woke up on its own fails here.
	async fn read_at(stream: &mut (impl AsyncRead + AsyncSeek + Unpin), at: u64, len: u64) -> Vec<u8> {
		stream.seek(SeekFrom::Start(at)).await.unwrap();
		let mut buf = vec![0; len as usize];
		timeout(Duration::from_secs(3), stream.read_exact(&mut buf))
			.await
			.expect("a reader should be fed promptly, not when a requester next wakes")
			.unwrap();
		buf
	}

	/// The engine patch end to end, over loopback: a stream fetches its window and
	/// nothing else, follows its reader, forgets what that reader left behind,
	/// gives the space back — and fetches a forgotten piece again, intact, when it
	/// is asked for. Then a download again, which has to end up with every byte.
	#[tokio::test(flavor = "multi_thread")]
	async fn stream_window() {
		let seed_dir = scratch("seed");
		// Never zero, so a punched hole read back as data can't pass for the film.
		let film: Vec<u8> = (0..LEN).map(|i| (i % 251 + 1) as u8).collect();
		std::fs::write(seed_dir.join("film.mkv"), &film).unwrap();
		let torrent = create_torrent(
			&seed_dir.join("film.mkv"),
			CreateTorrentOptions { piece_length: Some(PIECE as u32), ..Default::default() },
			&BlockingSpawner::new(1),
		)
		.await
		.unwrap()
		.as_bytes()
		.unwrap();

		let seeder = Session::new_with_opts(
			seed_dir.clone(),
			SessionOptions {
				dht: None,
				disable_local_service_discovery: true,
				listen: Some(ListenerOptions { listen_addr: (Ipv4Addr::LOCALHOST, 0).into(), ..Default::default() }),
				..Default::default()
			},
		)
		.await
		.unwrap();
		let seeding = seeder
			.add_torrent(
				AddTorrent::from_bytes(torrent.clone()),
				Some(AddTorrentOptions {
					output_folder: Some(seed_dir.to_string_lossy().into_owned()),
					overwrite: true,
					..Default::default()
				}),
			)
			.await
			.unwrap()
			.into_handle()
			.unwrap();
		seeding.wait_until_completed().await.unwrap();

		let leech_dir = scratch("leech");
		let leecher = Session::new_with_opts(
			leech_dir.clone(),
			SessionOptions { dht: None, disable_local_service_discovery: true, ..Default::default() },
		)
		.await
		.unwrap();
		let api = Api::new(leecher.clone(), None, None);
		// Paused until the window is set, or the first second of it downloads
		// whatever the natural order reaches.
		let handle = leecher
			.add_torrent(
				AddTorrent::from_bytes(torrent),
				Some(AddTorrentOptions {
					paused: true,
					initial_peers: Some(vec![seeder.listen_addr().unwrap()]),
					output_folder: Some(leech_dir.to_string_lossy().into_owned()),
					overwrite: true,
					..Default::default()
				}),
			)
			.await
			.unwrap()
			.into_handle()
			.unwrap();
		handle.wait_until_initialized().await.unwrap();
		handle.set_stream_window(8 * PIECE).unwrap();
		leecher.unpause(&handle).await.unwrap();
		let id = handle.id();
		let file = leech_dir.join("film.mkv");

		// A reader at the start: its window comes down, and nothing else does.
		let mut stream = handle.clone().stream(0).await.unwrap();
		assert_eq!(read_at(&mut stream, 0, PIECE).await, film[..PIECE as usize]);
		tokio::time::sleep(Duration::from_millis(500)).await;
		let have = held(&api, id);
		assert!(have[..9].iter().all(|h| *h), "the window ahead of the reader is fetched");
		assert!(!have[10..].iter().any(|h| *h), "and nothing past it");

		// Seeked half-way: the window follows, and without waiting to be noticed.
		let mid = LEN / 2;
		assert_eq!(read_at(&mut stream, mid, PIECE).await, film[mid as usize..(mid + PIECE) as usize]);

		// Behind the reader and outside its window: forgotten, then punched out.
		let live = handle.live().unwrap();
		assert!(live.forget_outside(0, 0).unwrap() >= 9 * PIECE, "what the reader left behind is forgotten");
		assert!(!held(&api, id)[..9].iter().any(|h| *h), "and no longer offered to anyone");
		#[cfg(target_os = "linux")]
		{
			use std::os::unix::fs::MetadataExt;
			let before = std::fs::metadata(&file).unwrap().blocks();
			live.forget_outside(0, 0).unwrap();
			assert!(std::fs::metadata(&file).unwrap().blocks() < before, "its space goes back on the next pass");
		}

		// Rewound: fetched again, and the film, not the zeros punched into it.
		assert_eq!(read_at(&mut stream, 0, PIECE).await, film[..PIECE as usize]);

		// A download again — the Download button — which has to finish whole.
		drop(stream);
		handle.set_stream_window(0).unwrap();
		timeout(Duration::from_secs(20), handle.wait_until_completed()).await.unwrap().unwrap();
		assert_eq!(std::fs::read(&file).unwrap(), film);

		let _ = std::fs::remove_dir_all(seed_dir);
		let _ = std::fs::remove_dir_all(leech_dir);
	}
}
