use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

static LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
struct Source {
    provider: String,
    url: String,
    branch: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Pending {
    stage: PathBuf,
    backup: PathBuf,
}
#[derive(Clone, Serialize, Deserialize)]
struct Clone {
    path: String,
    source: Source,
    directory: String,
    #[serde(default = "yes")]
    managed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pending: Option<Pending>,
}
fn yes() -> bool {
    true
}
fn registry(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| "应用数据目录不可用。")?;
    std::fs::create_dir_all(&path).map_err(|_| "无法创建仓库记录目录。")?;
    Ok(path.join("managed-clones.json"))
}
fn load(path: &Path) -> Result<Vec<Clone>, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "仓库记录损坏，未修改副本。".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(_) => Err("无法读取仓库记录。".into()),
    }
}
fn save(path: &Path, entries: &[Clone]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec(entries).map_err(|_| "仓库配置无效。")?,
    )
    .map_err(|_| "无法写入仓库记录。")?;
    std::fs::rename(temporary, path).map_err(|_| "无法保存仓库记录。".into())
}
pub fn validate_directory(directory: &str) -> Result<(), String> {
    if !directory.is_empty()
        && directory
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == ".." || p.contains(['\\', ':']))
    {
        return Err("阅读目录必须是仓库内的相对路径。".into());
    }
    Ok(())
}
pub fn register(
    app: &tauri::AppHandle,
    path: &Path,
    provider: String,
    url: String,
    branch: String,
    directory: String,
) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|_| "仓库注册锁不可用。")?;
    let registry = registry(app)?;
    let mut entries = load(&registry)?;
    let path = path.to_string_lossy().replace('\\', "/");
    entries.retain(|entry| !entry.path.eq_ignore_ascii_case(&path));
    entries.push(Clone {
        path,
        source: Source {
            provider,
            url,
            branch,
        },
        directory,
        pending: None,
        managed: true,
    });
    save(&registry, &entries)
}
fn matches(entry: &Clone, path: &str) -> bool {
    path.eq_ignore_ascii_case(&entry.path)
        || path
            .to_lowercase()
            .starts_with(&(entry.path.to_lowercase() + "/"))
}
fn owned_sibling(destination: &Path, candidate: &Path, prefix: &str) -> bool {
    candidate.parent() == destination.parent()
        && candidate
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with(prefix))
}
fn recover(entry: &mut Clone) -> Result<(), String> {
    if let Some(pending) = entry.pending.clone() {
        let destination = Path::new(&entry.path);
        if !owned_sibling(destination, &pending.stage, ".folio-stage-")
            || !owned_sibling(destination, &pending.backup, ".folio-backup-")
        {
            return Err("更新恢复路径无效。".into());
        }
        if !destination.exists() && pending.backup.exists() {
            std::fs::rename(&pending.backup, destination)
                .map_err(|_| "无法恢复原副本，请保留备份目录。")?;
        }
        if pending.backup.exists() && destination.exists() {
            if pending.stage.exists() {
                std::fs::remove_dir_all(&pending.stage).map_err(|_| "无法清理更新临时目录。")?;
            }
            std::fs::rename(destination, &pending.stage).map_err(|_| "无法恢复旧副本。")?;
            std::fs::rename(&pending.backup, destination).map_err(|_| "无法恢复旧副本。")?;
        }
        if pending.stage.exists() {
            std::fs::remove_dir_all(&pending.stage).map_err(|_| "无法清理更新临时目录。")?;
        }
        entry.pending = None;
    }
    Ok(())
}
pub async fn inspect(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<serde_json::Value, String> {
    let registry = registry(window.app_handle())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LOCK.lock().map_err(|_| "仓库正在处理。")?;
        let mut entries = load(&registry)?;
        if let Some(index) = entries.iter().position(|e| matches(e, &path)) {
            if !window
                .fs_scope()
                .is_allowed(Path::new(&entries[index].path))
            {
                return Err("此仓库的文件夹授权已失效。".into());
            }
            recover(&mut entries[index])?;
            save(&registry, &entries)?;
            serde_json::to_value(&entries[index]).map_err(|_| "无法读取仓库信息。".into())
        } else {
            let directory = dunce::canonicalize(&path).map_err(|_| "目录不可用。")?;
            if !window.fs_scope().is_allowed(&directory) || !directory.join(".git").is_dir() {
                return Ok(serde_json::Value::Null);
            }
            let read_git = |args: &[&str]| -> Option<String> {
                let mut command = std::process::Command::new("git");
                command
                    .arg("-C")
                    .arg(&directory)
                    .args(args)
                    .env("GIT_TERMINAL_PROMPT", "0");
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    command.creation_flags(0x0800_0000);
                }
                let result = command.output().ok()?;
                result
                    .status
                    .success()
                    .then(|| String::from_utf8_lossy(&result.stdout).trim().to_owned())
            };
            let Some(url) = read_git(&["config", "--get", "remote.origin.url"]) else {
                return Ok(serde_json::Value::Null);
            };
            let Ok(url) = crate::repository_url::https_url(&url) else {
                return Ok(serde_json::Value::Null);
            };
            let branch = read_git(&["symbolic-ref", "--short", "HEAD"])
                .or_else(|| read_git(&["describe", "--tags", "--exact-match", "HEAD"]))
                .unwrap_or_default();
            let provider = if url.host_str() == Some("github.com") {
                "github"
            } else if url.host_str().is_some_and(|s| s.contains("gitlab")) {
                "gitlab"
            } else {
                "git"
            };
            serde_json::to_value(Clone {
                path: directory.to_string_lossy().replace('\\', "/"),
                source: Source {
                    provider: provider.into(),
                    url: url.to_string(),
                    branch,
                },
                directory: String::new(),
                pending: None,
                managed: false,
            })
            .map_err(|_| "无法读取仓库信息。".into())
        }
    })
    .await
    .map_err(|_| "无法读取克隆信息。")?
}
pub async fn adopt(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    let info: Clone = serde_json::from_value(inspect(window.clone(), path).await?)
        .map_err(|_| "无法识别此 Git 文件夹。")?;
    if info.managed {
        return Ok(());
    }
    register(
        window.app_handle(),
        Path::new(&info.path),
        info.source.provider,
        info.source.url,
        info.source.branch,
        info.directory,
    )
}
pub async fn update(
    window: tauri::WebviewWindow,
    path: String,
    source: serde_json::Value,
    directory: String,
) -> Result<String, String> {
    let source: Source = serde_json::from_value(source).map_err(|_| "仓库配置无效。")?;
    crate::repository_url::https_url(&source.url)?;
    validate_directory(&directory)?;
    let registry = registry(window.app_handle())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LOCK.lock().map_err(|_| "仓库正在更新。")?;
        let mut entries = load(&registry)?;
        let index = entries
            .iter()
            .position(|e| matches(e, &path))
            .ok_or("此目录不是 Folio 管理的克隆副本，不能覆盖。")?;
        let destination = PathBuf::from(&entries[index].path);
        if !window.fs_scope().is_allowed(&destination) {
            return Err("此仓库的文件夹授权已失效，请重新打开文件夹。".into());
        }
        recover(&mut entries[index])?;
        let canonical = dunce::canonicalize(&destination).map_err(|_| "本地副本不存在。")?;
        if canonical != destination
            || std::fs::symlink_metadata(&destination)
                .map_err(|_| "目录不可用。")?
                .file_type()
                .is_symlink()
        {
            return Err("不能替换链接目录。".into());
        }
        let parent = destination.parent().ok_or("仓库位置无效。")?;
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "系统时间无效。")?
            .as_nanos();
        let stage = parent.join(format!(".folio-stage-{id}"));
        let backup = parent.join(format!(".folio-backup-{id}"));
        if stage.exists() || backup.exists() {
            return Err("更新临时目录已存在，请重试。".into());
        }
        entries[index].pending = Some(Pending {
            stage: stage.clone(),
            backup: backup.clone(),
        });
        save(&registry, &entries)?;
        let downloaded = download(&source, &stage, &directory);
        if let Err(error) = downloaded {
            recover(&mut entries[index])?;
            save(&registry, &entries)?;
            return Err(error);
        }
        if std::fs::rename(&destination, &backup).is_err() {
            recover(&mut entries[index])?;
            save(&registry, &entries)?;
            return Err("本地文件正在使用，无法替换；原副本保留。".into());
        }
        if std::fs::rename(&stage, &destination).is_err() {
            recover(&mut entries[index])?;
            save(&registry, &entries)?;
            return Err("替换失败，已恢复原副本。".into());
        }
        let mut previous = entries[index].clone();
        entries[index].source = source;
        entries[index].directory = directory.clone();
        entries[index].pending = None;
        if let Err(error) = save(&registry, &entries) {
            recover(&mut previous)?;
            return Err(error);
        }
        let _ = std::fs::remove_dir_all(backup);
        Ok(destination
            .join(directory)
            .to_string_lossy()
            .replace('\\', "/"))
    })
    .await
    .map_err(|_| "仓库更新任务中断。")?
}

fn download(source: &Source, stage: &Path, directory: &str) -> Result<(), String> {
    let mut command = std::process::Command::new("git");
    command.args([
        "-c",
        "http.lowSpeedLimit=1",
        "-c",
        "http.lowSpeedTime=35",
        "clone",
        "--depth",
        "1",
    ]);
    if !source.branch.is_empty() {
        command.args(["--branch", &source.branch]);
    }
    command
        .arg("--")
        .arg(&source.url)
        .arg(&stage)
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .output()
        .map_err(|_| "无法运行 Git。".to_string())
        .and_then(|output| {
            if !output.status.success() {
                return Err("下载失败，原副本保留。请检查网络、Git 凭据和分支。".into());
            }
            let selected =
                dunce::canonicalize(stage.join(&directory)).map_err(|_| "指定阅读目录不存在。")?;
            let root = dunce::canonicalize(&stage).map_err(|_| "新副本不可用。")?;
            if !selected.is_dir() || !selected.starts_with(root) {
                return Err("阅读目录超出新副本。".into());
            }
            Ok(())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, Clone) {
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("folio-transaction-test-{id}"));
        std::fs::create_dir(&root).unwrap();
        let entry = Clone {
            path: root.join("repository").to_string_lossy().to_string(),
            source: Source {
                provider: "git".into(),
                url: "https://example.com/repo".into(),
                branch: "main".into(),
            },
            directory: "".into(),
            managed: true,
            pending: Some(Pending {
                stage: root.join(".folio-stage-test"),
                backup: root.join(".folio-backup-test"),
            }),
        };
        (root, entry)
    }
    #[test]
    fn interrupted_download_keeps_old_copy() {
        let (root, mut entry) = fixture();
        std::fs::create_dir(&entry.path).unwrap();
        std::fs::write(Path::new(&entry.path).join("old.md"), "old").unwrap();
        std::fs::create_dir(&entry.pending.as_ref().unwrap().stage).unwrap();
        recover(&mut entry).unwrap();
        assert!(Path::new(&entry.path).join("old.md").exists());
        assert!(entry.pending.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn interrupted_switch_restores_backup_before_and_after_promotion() {
        for promoted in [false, true] {
            let (root, mut entry) = fixture();
            let pending = entry.pending.as_ref().unwrap();
            std::fs::create_dir(&pending.backup).unwrap();
            std::fs::write(pending.backup.join("old.md"), "old").unwrap();
            let new = if promoted {
                PathBuf::from(&entry.path)
            } else {
                pending.stage.clone()
            };
            std::fs::create_dir(&new).unwrap();
            std::fs::write(new.join("new.md"), "new").unwrap();
            recover(&mut entry).unwrap();
            assert!(Path::new(&entry.path).join("old.md").exists());
            assert!(!Path::new(&entry.path).join("new.md").exists());
            std::fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn recovery_refuses_unowned_paths_and_traversal() {
        let (root, mut entry) = fixture();
        entry.pending.as_mut().unwrap().stage = root.join("user-directory");
        std::fs::create_dir(root.join("user-directory")).unwrap();
        assert!(recover(&mut entry).is_err());
        assert!(root.join("user-directory").exists());
        for path in [
            "../docs",
            "docs/../files",
            "C:/user",
            "docs\\..\\user",
            "/docs",
        ] {
            assert!(validate_directory(path).is_err());
        }
        assert!(validate_directory("docs/中文").is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn real_git_download_validates_branch_and_directory_without_touching_old_copy() {
        let (root, mut entry) = fixture();
        let origin = root.join("origin");
        std::fs::create_dir(&origin).unwrap();
        let git = |args: &[&str]| {
            let result = std::process::Command::new("git")
                .arg("-C")
                .arg(&origin)
                .args(args)
                .output()
                .unwrap();
            assert!(result.status.success(), "Git fixture setup failed");
        };
        git(&["init", "-b", "main"]);
        std::fs::create_dir(origin.join("docs")).unwrap();
        std::fs::write(origin.join("docs/new.md"), "new version").unwrap();
        git(&["add", "."]);
        git(&[
            "-c",
            "user.name=Folio Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            "fixture",
        ]);
        let source = Source {
            provider: "git".into(),
            url: origin.to_string_lossy().to_string(),
            branch: "main".into(),
        };
        let stage = entry.pending.as_ref().unwrap().stage.clone();
        std::fs::create_dir(&entry.path).unwrap();
        std::fs::write(Path::new(&entry.path).join("old.md"), "old version").unwrap();
        download(&source, &stage, "docs").unwrap();
        assert_eq!(
            std::fs::read_to_string(stage.join("docs/new.md")).unwrap(),
            "new version"
        );
        assert!(download(&source, &root.join(".folio-stage-invalid"), "missing").is_err());
        let invalid = Source {
            branch: "missing-branch".into(),
            ..source
        };
        assert!(download(&invalid, &root.join(".folio-stage-branch"), "").is_err());
        recover(&mut entry).unwrap();
        assert_eq!(
            std::fs::read_to_string(Path::new(&entry.path).join("old.md")).unwrap(),
            "old version"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
