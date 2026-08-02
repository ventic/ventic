import { defineConfig } from 'bumpp'

export default defineConfig({
  release: 'prompt',
  // The pushed tag is what starts .github/workflows/release.yml.
  commit: true,
  tag: true,
  push: true,
  // bumpp knows nothing about Cargo.lock, so it would keep saying 0.1.0 until
  // someone's next build silently rewrote it. `-w` touches only the workspace
  // member's own entry, never a dependency. It runs before the commit, and
  // `all` is what gets the lockfile into it — so bump from a clean tree.
  execute: 'cargo update --manifest-path src-tauri/Cargo.toml -w --offline',
  all: true,
  files: [
    'package.json',
    'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml',
  ],
})
