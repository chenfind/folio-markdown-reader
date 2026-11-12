pub mod credentials;
#[cfg(windows)]
mod managed_clones;
#[cfg(windows)]
mod windows_credentials;
#[cfg(windows)]
mod windows_git;

#[tauri::command]
pub fn runtime_platform() -> &'static str {
    std::env::consts::OS
}

#[tauri::command]
pub async fn local_clone_info(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    {
        return managed_clones::inspect(window, path).await;
    }
    #[cfg(not(windows))]
    {
        let _ = (window, path);
        Ok(serde_json::Value::Null)
    }
}
#[tauri::command]
pub async fn local_clone_adopt(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        managed_clones::adopt(window, path).await
    }
    #[cfg(not(windows))]
    {
        let _ = (window, path);
        Err("此平台不需要接管本地目录。".into())
    }
}

#[tauri::command]
pub async fn local_clone_update(
    window: tauri::WebviewWindow,
    path: String,
    source: serde_json::Value,
    directory: String,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        managed_clones::update(window, path, source, directory).await
    }
    #[cfg(not(windows))]
    {
        let _ = (window, path, source, directory);
        Err("此平台不使用桌面克隆。".into())
    }
}

#[tauri::command]
pub async fn remote_clone(
    window: tauri::WebviewWindow,
    url: String,
    branch: String,
    provider: String,
    directory: String,
    parent: String,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        windows_git::clone_repository(window, url, branch, provider, directory, parent).await
    }
    #[cfg(not(windows))]
    {
        let _ = (window, url, branch, provider, directory, parent);
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
            "choose" | "list" | "read" | "cloneStart" | "cloneStatus" | "cloneCancel" | "cloneInfo"
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
