use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::OnceLock;
use tauri::{
    Wry,
    plugin::{PluginHandle, TauriPlugin},
};

static MOBILE: OnceLock<PluginHandle<Wry>> = OnceLock::new();

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("folio-mobile")
        .setup(|_, api| {
            let handle = api.register_android_plugin("app.folio.mobile", "FolioMobilePlugin")?;
            MOBILE
                .set(handle)
                .map_err(|_| "Android services were already initialized")?;
            Ok(())
        })
        .build()
}

fn handle() -> Result<&'static PluginHandle<Wry>, String> {
    MOBILE.get().ok_or_else(|| "Android 服务尚未就绪。".into())
}

pub async fn request(command: &str, payload: Value) -> Result<Value, String> {
    handle()?
        .run_mobile_plugin_async(command, payload)
        .await
        .map_err(|error| error.to_string())
}

pub fn read_secret(key: &str) -> Option<String> {
    let value: Value = handle()
        .ok()?
        .run_mobile_plugin("readSecret", json!({ "key": key }))
        .ok()?;
    value["value"].as_str().map(str::to_owned)
}

pub fn write_secret(key: &str, token: &str) -> Result<(), String> {
    let _: Value = handle()?
        .run_mobile_plugin("writeSecret", json!({ "key": key, "value": token }))
        .map_err(|_| "无法安全保存访问令牌。")?;
    Ok(())
}

#[derive(Serialize)]
struct HttpRequest {
    url: String,
    headers: std::collections::HashMap<String, String>,
}

#[derive(Deserialize)]
struct HttpResponse {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    data: String,
}

/// Android HTTPS uses the system trust store through HttpURLConnection.
pub async fn http(request: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    let request = request.build().map_err(|_| "无法准备仓库请求。")?;
    let input = HttpRequest {
        url: request.url().to_string(),
        headers: request
            .headers()
            .iter()
            .filter_map(|(key, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (key.to_string(), value.to_owned()))
            })
            .collect(),
    };
    let response: HttpResponse = handle()?
        .run_mobile_plugin_async("http", input)
        .await
        .map_err(|_| "仓库连接失败，请检查网络、VPN 和服务器证书。")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(response.data)
        .map_err(|_| "仓库响应无法解析。")?;
    let mut builder = ::http::Response::builder().status(response.status);
    for (name, value) in response.headers {
        builder = builder.header(name, value);
    }
    builder
        .body(bytes)
        .map(Into::into)
        .map_err(|_| "仓库响应头无法解析。".into())
}
