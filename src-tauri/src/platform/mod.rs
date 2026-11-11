pub mod credentials;
#[cfg(windows)]
mod windows_credentials;
#[cfg(windows)]
mod windows_git;

#[tauri::command]
pub fn runtime_platform() -> &'static str {
    std::env::consts::OS
}

#[tauri::command]
pub async fn remote_clone(
    window: tauri::WebviewWindow,
    url: String,
    branch: String,
    parent: String,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        windows_git::clone_repository(window, url, branch, parent).await
    }
    #[cfg(not(windows))]
    {
        let _ = (window, url, branch, parent);
        Err("当前平台的内置 Git 克隆适配尚未完成。".into())
    }
}

#[cfg(target_os = "android")]
pub mod android;

#[tauri::command]
pub async fn mobile_request(
    command: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        if !matches!(
            command.as_str(),
            "choose" | "list" | "read" | "cloneStart" | "cloneStatus" | "cloneCancel"
        ) {
            return Err("不支持此移动端操作。".into());
        }
        android::request(&command, payload).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (command, payload);
        Err("此操作需要 Android。".into())
    }
}
