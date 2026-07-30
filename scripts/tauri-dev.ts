import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import process from 'node:process'
import { ensureMpv } from './mpv'

const DEFAULT_PORT = 3000

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '0.0.0.0')
  })
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + 99}`)
}

async function main(): Promise<void> {
  // A Windows build declares mpv.exe as a resource, and a missing resource
  // fails the dev build the same way it fails a release one.
  if (process.platform === 'win32')
    await ensureMpv()

  const port = await findAvailablePort(DEFAULT_PORT)

  if (port !== DEFAULT_PORT) {
    console.log(`Port ${DEFAULT_PORT} is busy, using port ${port}`)
  }

  const tauriConfig = JSON.stringify({
    build: {
      devUrl: `http://localhost:${port}`,
      beforeDevCommand: `bun run dev --port ${port}`,
    },
  })

  const tauri = spawn('bun', ['run', 'tauri', 'dev', '--config', tauriConfig], {
    stdio: 'inherit',
    cwd: process.cwd(),
    // GDK_BACKEND=x11 (needed so mpv can embed into the window) is set by the
    // Rust side now, so packaged builds get it too — see player::init().
  })

  tauri.on('close', code => {
    process.exit(code ?? 0)
  })
}

main()
