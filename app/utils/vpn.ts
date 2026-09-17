/**
 * Tying the torrent engine to one network interface — a VPN's — so that when the
 * VPN drops, downloading and seeding stop instead of carrying on from the real
 * address. All of it is src-tauri/src/vpn.rs; these are its two commands.
 */
import { invoke } from '@tauri-apps/api/core'

export interface EngineInterface {
  name: string
  addresses: string[]
}

export interface EngineInterfaces {
  /** What the engine is bound to, `null` for any connection. */
  bound: string | null
  /** What is up right now. A tunnel that has dropped isn't in here. */
  available: EngineInterface[]
}

/** `null` where the engine can't be bound — Windows, Android, a browser. */
export async function engineInterfaces(): Promise<EngineInterfaces | null> {
  return await invoke<EngineInterfaces | null>('engine_interfaces').catch(() => null)
}

/** Bind the engine to `name`, or to any connection. It restarts within seconds. */
export async function bindEngine(name: string | null): Promise<void> {
  await invoke('set_engine_interface', { name })
}
