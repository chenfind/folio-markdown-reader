#[cfg(windows)]
pub use super::windows_credentials::{read, write};

#[cfg(target_os = "android")]
pub use super::android::{read_secret as read, write_secret as write};

#[cfg(not(any(windows, target_os = "android")))]
pub fn read(_: &str) -> Option<String> {
    None
}

#[cfg(not(any(windows, target_os = "android")))]
pub fn write(_: &str, _: &str) -> Result<(), String> {
    Err("当前平台的安全凭据适配尚未完成。".into())
}
