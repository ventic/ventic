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

    // Those absolute paths are then rewritten out of the binary by
    // scripts/build/macos/bundle-dylib.ts, which stages the dylibs here for
    // tauri.macos.conf.json to carry into Contents/Resources. That happens at
    // bundle time, but tauri_build below resolves the `dylibs/*` glob *now* and
    // fails if it matches nothing — so a clone that has never been built dies
    // here, long before the script it is waiting for gets to run. Seed the
    // directory with the one file that isn't collected: mpv is GPL and travels
    // inside the bundle, the same as the mpv.exe the Windows build carries.
    println!("cargo:rerun-if-changed=../scripts/build/mpv-LICENSE.GPL");
    std::fs::create_dir_all("dylibs").expect("create dylibs/");
    std::fs::copy("../scripts/build/mpv-LICENSE.GPL", "dylibs/LICENSE-mpv.txt")
      .expect("stage mpv's licence into dylibs/");
  }

  tauri_build::build()
}
