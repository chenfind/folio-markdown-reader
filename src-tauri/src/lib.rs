mod platform;
mod repositories;
mod repository_url;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(platform::android::init());
    builder
        .invoke_handler(tauri::generate_handler![
            repositories::remote_resolve,
            repositories::remote_list,
            repositories::remote_github_tree,
            repositories::remote_read,
            platform::remote_clone,
            platform::runtime_platform,
            platform::mobile_request,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Folio");
}
