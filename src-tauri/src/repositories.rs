use crate::platform::credentials as credential;
use crate::repository_url::https_url;
use reqwest::{Client, RequestBuilder, Response, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{sync::LazyLock, time::Duration};

static CLIENT: LazyLock<Result<Client, reqwest::Error>> = LazyLock::new(|| {
    Client::builder()
        .user_agent("Folio Markdown Reader")
        .redirect(Policy::none())
        .timeout(Duration::from_secs(35))
        .build()
});

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    provider: String,
    url: String,
    branch: String,
}

struct Repository {
    provider: String,
    url: Url,
    api: Url,
}

impl Repository {
    fn parse(source: &Source) -> Result<Self, String> {
        let mut url = https_url(&source.url)?;
        let path = url.path().trim_end_matches(".git").to_owned();
        url.set_path(&path);
        let pieces: Vec<_> = url.path_segments().ok_or("仓库路径无效。")?.collect();
        let github = source.provider == "github";
        if (!github && source.provider != "gitlab")
            || pieces.len() < 2
            || (github && pieces.len() != 2)
            || pieces
                .iter()
                .any(|p| p.is_empty() || *p == "-" || p.contains('%'))
        {
            return Err("请填写仓库首页地址，例如 https://github.com/owner/repo。".into());
        }

        let mut api = url.clone();
        if github && url.host_str() == Some("github.com") {
            api.set_host(Some("api.github.com"))
                .map_err(|_| "GitHub 地址无效。")?;
        }
        api.set_path("/");
        {
            let mut segments = api.path_segments_mut().map_err(|_| "仓库地址无效。")?;
            segments.clear();
            if github {
                if url.host_str() != Some("github.com") {
                    segments.extend(["api", "v3"]);
                }
                segments.push("repos").extend(pieces);
            } else {
                segments.extend(["api", "v4", "projects", path.trim_start_matches('/')]);
            }
        }
        Ok(Self {
            provider: source.provider.clone(),
            url,
            api,
        })
    }

    fn endpoint(&self, parts: &[&str]) -> Url {
        let mut url = self.api.clone();
        url.path_segments_mut()
            .expect("HTTPS URL has path segments")
            .extend(parts.iter().copied());
        url
    }

    fn credential_target(&self) -> String {
        format!("Folio:{}:{}", self.provider, self.url)
    }

    fn request(&self, url: Url, token: Option<&str>) -> Result<RequestBuilder, String> {
        let client = CLIENT.as_ref().map_err(|_| "无法初始化网络连接。")?;
        let request = client.get(url);
        let token = token.filter(|value| !value.is_empty());
        Ok(match (self.provider.as_str(), token) {
            ("github", Some(value)) => request.bearer_auth(value),
            ("gitlab", Some(value)) => request.header("PRIVATE-TOKEN", value),
            _ => request,
        })
    }
}

async fn send(request: RequestBuilder) -> Result<Response, String> {
    #[cfg(target_os = "android")]
    let response = crate::platform::android::http(request).await?;
    #[cfg(not(target_os = "android"))]
    let response = request.send().await.map_err(|err| {
        if err.is_timeout() {
            "仓库请求超时，请检查网络或 VPN。"
        } else {
            "无法连接仓库，请检查地址、网络和证书。"
        }
    })?;
    let message = match response.status().as_u16() {
        200 => return Ok(response),
        401 => "访问令牌无效或已过期，请重新授权。",
        403 if response
            .headers()
            .get("x-ratelimit-remaining")
            .is_some_and(|value| value == "0") =>
        {
            "GitHub API 请求达到上限，请稍后刷新。"
        }
        403 => "仓库拒绝读取，请检查令牌权限或组织授权。",
        404 => "未找到仓库、分支或路径。私有仓库需要有效的读取令牌。",
        429 => "仓库请求过于频繁，请稍后刷新。",
        300..=399 => "服务器要求重定向，请填写仓库的最终 HTTPS 地址。",
        _ => "仓库服务器暂时无法提供内容。",
    };
    Err(message.into())
}

async fn bounded_bytes(mut response: Response, limit: usize) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("远程内容超过大小限制。".into());
    }
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "远程内容读取中断。")? {
        if data.len() + chunk.len() > limit {
            return Err("远程内容超过大小限制。".into());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

async fn json(request: RequestBuilder) -> Result<Value, String> {
    serde_json::from_slice(&bounded_bytes(send(request).await?, 24 * 1024 * 1024).await?)
        .map_err(|_| "仓库返回了无法识别的数据。".into())
}

fn valid_path(path: &str) -> bool {
    path.is_empty()
        || path.split('/').all(|part| {
            !part.is_empty() && part != "." && part != ".." && !part.contains(['\\', '\0'])
        })
}

#[derive(Serialize)]
pub struct Revision {
    commit: String,
    tree: Option<String>,
}

#[tauri::command]
pub async fn remote_resolve(
    source: Source,
    token: Option<String>,
    directory: String,
) -> Result<Revision, String> {
    let repository = Repository::parse(&source)?;
    if !valid_path(&directory) {
        return Err("阅读目录必须是仓库内的相对路径。".into());
    }
    let stored = credential::read(&repository.credential_target());
    let secret = token.as_deref().or(stored.as_deref());
    let branch = if source.branch.trim().is_empty() {
        let value = json(repository.request(repository.api.clone(), secret)?).await?;
        value["default_branch"]
            .as_str()
            .ok_or("仓库没有可读取的默认分支。")?
            .to_owned()
    } else {
        source.branch.trim().to_owned()
    };
    let endpoint = if repository.provider == "github" {
        repository.endpoint(&["commits", &branch])
    } else {
        repository.endpoint(&["repository", "commits", &branch])
    };
    let value = json(repository.request(endpoint, secret)?).await?;
    let github = repository.provider == "github";
    let commit = value[if github { "sha" } else { "id" }]
        .as_str()
        .ok_or("无法解析仓库提交。")?
        .to_owned();
    let tree = value["commit"]["tree"]["sha"].as_str().map(str::to_owned);
    // A new connection must validate the selected directory before storing its credential.
    if token.is_some() || !directory.is_empty() {
        let entries = read_directory(&repository, &commit, &directory, secret).await?;
        if entries.is_empty() && !directory.is_empty() {
            return Err("指定阅读目录为空或不存在。".into());
        }
    }
    if let Some(token) = token.as_deref().filter(|token| !token.is_empty()) {
        credential::write(&repository.credential_target(), token)?;
    }
    Ok(Revision { commit, tree })
}

#[derive(Serialize)]
pub struct RemoteEntry {
    name: String,
    directory: bool,
}

async fn read_directory(
    repository: &Repository,
    commit: &str,
    path: &str,
    secret: Option<&str>,
) -> Result<Vec<RemoteEntry>, String> {
    let mut output = Vec::new();
    if repository.provider == "github" {
        let mut endpoint = repository.endpoint(&["contents"]);
        if !path.is_empty() {
            endpoint
                .path_segments_mut()
                .map_err(|_| "目录路径无效。")?
                .extend(path.split('/'));
        }
        let value = json(
            repository
                .request(endpoint, secret)?
                .query(&[("ref", commit)]),
        )
        .await?;
        let entries = value.as_array().ok_or("指定路径不是目录。")?;
        for item in entries {
            let kind = item["type"].as_str().unwrap_or_default();
            if let Some(name) = item["name"]
                .as_str()
                .filter(|name| valid_path(name) && !name.contains('/'))
            {
                if matches!(kind, "file" | "dir") && item["submodule_git_url"].is_null() {
                    output.push(RemoteEntry {
                        name: name.into(),
                        directory: kind == "dir",
                    });
                }
            }
        }
    } else {
        let endpoint = repository.endpoint(&["repository", "tree"]);
        let mut page = 1u32;
        loop {
            let page_text = page.to_string();
            let request = repository.request(endpoint.clone(), secret)?.query(&[
                ("ref", commit),
                ("path", path),
                ("per_page", "100"),
                ("page", &page_text),
            ]);
            let response = send(request).await?;
            let next = response
                .headers()
                .get("x-next-page")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u32>().ok());
            let value: Value =
                serde_json::from_slice(&bounded_bytes(response, 4 * 1024 * 1024).await?)
                    .map_err(|_| "仓库返回了无法识别的目录。")?;
            let entries = value.as_array().ok_or("指定路径不是目录。")?;
            for item in entries {
                let kind = item["type"].as_str().unwrap_or_default();
                if let Some(name) = item["name"]
                    .as_str()
                    .filter(|name| valid_path(name) && !name.contains('/'))
                {
                    if matches!(kind, "tree" | "blob") && item["mode"] != "120000" {
                        output.push(RemoteEntry {
                            name: name.into(),
                            directory: kind == "tree",
                        });
                    }
                }
            }
            match next {
                Some(value) if value > page => page = value,
                None if entries.len() == 100 => page += 1,
                _ => break,
            }
            if page > 1_000 || output.len() > 100_000 {
                return Err("目录条目过多，请选择更小的阅读目录。".into());
            }
        }
    }
    Ok(output)
}

#[tauri::command]
pub async fn remote_list(
    source: Source,
    commit: String,
    path: String,
) -> Result<Vec<RemoteEntry>, String> {
    if !valid_path(&path) {
        return Err("目录路径无效。".into());
    }
    let repository = Repository::parse(&source)?;
    let secret = credential::read(&repository.credential_target());
    read_directory(&repository, &commit, &path, secret.as_deref()).await
}

#[tauri::command]
pub async fn remote_github_tree(
    source: Source,
    tree: String,
) -> Result<Option<Vec<Value>>, String> {
    let repository = Repository::parse(&source)?;
    if repository.provider != "github" {
        return Ok(None);
    }
    let secret = credential::read(&repository.credential_target());
    let value = json(
        repository
            .request(
                repository.endpoint(&["git", "trees", &tree]),
                secret.as_deref(),
            )?
            .query(&[("recursive", "1")]),
    )
    .await?;
    if value["truncated"] == true {
        return Ok(None);
    }
    let entries = value["tree"]
        .as_array()
        .ok_or("仓库返回了无法识别的目录树。")?;
    Ok(Some(entries.iter().filter(|item| item["path"].as_str().is_some_and(valid_path)).map(|item| {
        serde_json::json!({ "path": item["path"], "type": item["type"], "mode": item["mode"] })
    }).collect()))
}

#[tauri::command]
pub async fn remote_read(
    source: Source,
    commit: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    if path.is_empty() || !valid_path(&path) {
        return Err("文档路径无效。".into());
    }
    let repository = Repository::parse(&source)?;
    let secret = credential::read(&repository.credential_target());
    let request = if repository.provider == "github" {
        let mut endpoint = repository.endpoint(&["contents"]);
        endpoint
            .path_segments_mut()
            .map_err(|_| "文档路径无效。")?
            .extend(path.split('/'));
        repository
            .request(endpoint, secret.as_deref())?
            .header("Accept", "application/vnd.github.raw+json")
            .query(&[("ref", &commit)])
    } else {
        repository
            .request(
                repository.endpoint(&["repository", "files", &path, "raw"]),
                secret.as_deref(),
            )?
            .query(&[("ref", &commit)])
    };
    let bytes = bounded_bytes(send(request).await?, 24 * 1024 * 1024).await?;
    Ok(tauri::ipc::Response::new(bytes))
}
