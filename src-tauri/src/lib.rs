//! Native shell for Tracklet. The web frontend does all the work; native
//! commands, global shortcuts, tray and filesystem access can be added here.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Tracklet");
}
