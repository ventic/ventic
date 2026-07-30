import { defineConfig } from 'bumpp'

export default defineConfig({
  release: 'prompt',
  // The pushed tag is what starts .github/workflows/release.yml.
  commit: true,
  tag: true,
  push: true,
  files: [
    'package.json',
    'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml',
  ],
})
