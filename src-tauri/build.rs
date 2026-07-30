fn main() {
  // tauri::generate_context! bakes icons/32x32.png in as the window + tray icon,
  // but a proc macro can't tell cargo about it — without this, a regenerated logo
  // never triggers a rebuild and the old icon stays in the binary.
  println!("cargo:rerun-if-changed=icons");

  // The macOS player links libmpv (see src/player_macos.rs), and neither
  // Homebrew's nor MacPorts' lib directory is on the linker's default search
  // path. Without this the build ends in `ld: library 'mpv' not found`, which
  // says nothing about `brew install mpv` being the fix.
  //
  // CARGO_CFG_TARGET_OS rather than `cfg!`: in a build script that would be the
  // machine doing the building, which is only the same thing by coincidence.
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
    for dir in ["/opt/homebrew/lib", "/usr/local/lib", "/opt/local/lib"] {
      if std::path::Path::new(dir).is_dir() {
        println!("cargo:rustc-link-search=native={dir}");
      }
    }
  }

  tauri_build::build()
}
