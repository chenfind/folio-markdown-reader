use reqwest::Url;

pub(crate) fn https_url(input: &str) -> Result<Url, String> {
    let mut url = Url::parse(input.trim()).map_err(|_| "请输入有效的仓库地址。")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("请使用不含账号、密码、查询参数或片段的 HTTPS 仓库地址。".into());
    }
    let path = url.path().trim_end_matches('/').to_owned();
    url.set_path(&path);
    Ok(url)
}
