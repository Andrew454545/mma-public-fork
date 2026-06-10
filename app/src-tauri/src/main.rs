// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // `--serve` runs the headless web sidecar instead of the desktop app.
  // Gated by the `web-serve` feature so release builds don't compile it in.
  #[cfg(feature = "web-serve")]
  if std::env::args().any(|a| a == "--serve") {
    app_lib::serve::run_server();
    return;
  }
  // `--export-bindings` regenerates ../src/bindings.gen.ts and exits, without
  // launching the app. Breaks the deadlock when broken bindings block the frontend build.
  #[cfg(debug_assertions)]
  if std::env::args().any(|a| a == "--export-bindings") {
    let out = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/bindings.gen.ts");
    app_lib::specta_builder()
      .export(specta_typescript::Typescript::default(), &out)
      .expect("bindings export failed");
    println!("bindings exported to {}", out.display());
    return;
  }
  app_lib::run();
}
