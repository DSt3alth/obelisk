// OBELISK — Windows desktop shell. All game logic lives in www/.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running OBELISK");
}
