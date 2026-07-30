fn main() {
  // tauri::generate_context! bakes icons/32x32.png in as the window + tray icon,
  // but a proc macro can't tell cargo about it — without this, a regenerated logo
  // never triggers a rebuild and the old icon stays in the binary.
  println!("cargo:rerun-if-changed=icons");
  tauri_build::build()
}
