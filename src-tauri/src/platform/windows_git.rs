use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

pub async fn clone_repository(
    window: tauri::WebviewWindow,
    url: String,
    branch: String,
    provider: String,
    directory: String,
    parent: String,
) -> Result<String, String> {
    let url = crate::repository_url::https_url(&url)?;
    super::managed_clones::validate_directory(&directory)?;
    let app = window.app_handle().clone();
    let name = url
        .path_segments()
        .and_then(|mut parts| parts.next_back())
        .unwrap_or_default()
        .trim_end_matches(".git");
    if name.is_empty()
        || name.starts_with('.')
        || name.ends_with('.')
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err("无法从此地址生成安全的本地文件夹名称。".into());
    }
    let parent = dunce::canonicalize(PathBuf::from(parent)).map_err(|_| "克隆位置不可用。")?;
    if window.label() != "main" || !parent.is_dir() || !window.fs_scope().is_allowed(&parent) {
        return Err("请通过文件夹选择器指定克隆位置。".into());
    }
    let destination = parent.join(name);
    if destination.exists() {
        return Err("目标文件夹已存在，请另选一个位置。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut git = std::process::Command::new("git");
        git.args([
            "-c",
            "http.lowSpeedLimit=1",
            "-c",
            "http.lowSpeedTime=35",
            "clone",
            "--depth",
            "1",
        ]);
        if !branch.trim().is_empty() {
            git.args(["--branch", branch.trim()]);
        }
        git.arg("--").arg(url.as_str()).arg(&destination);
        git.env("GIT_TERMINAL_PROMPT", "0");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            git.creation_flags(0x0800_0000);
        }
        let output = git
            .output()
            .map_err(|_| "无法运行 Git，请确认已安装 Git 并将它加入 PATH。")?;
        if !output.status.success() {
            return Err(
                "克隆失败。请检查仓库地址、分支和 Git 凭据。私有仓库使用 Git 自己的登录凭据。"
                    .into(),
            );
        }
        let canonical = dunce::canonicalize(&destination).map_err(|_| "无法打开已克隆的目录。")?;
        let selected =
            dunce::canonicalize(canonical.join(&directory)).map_err(|_| "指定阅读目录不存在。")?;
        if !selected.is_dir() || !selected.starts_with(&canonical) {
            return Err("指定阅读目录不可用。".into());
        }
        super::managed_clones::register(
            &app,
            &canonical,
            provider,
            url.to_string(),
            branch,
            directory.clone(),
        )?;
        Ok(canonical
            .join(directory)
            .to_string_lossy()
            .replace('\\', "/"))
    })
    .await
    .map_err(|_| "克隆任务未能完成。")?
}
