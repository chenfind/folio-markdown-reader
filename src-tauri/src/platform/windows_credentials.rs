use std::{ffi::c_void, ptr, slice};
use windows_sys::Win32::Security::Credentials::{
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredFree, CredReadW, CredWriteW,
};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain([0]).collect()
}

pub fn read(target: &str) -> Option<String> {
    let name = wide(target);
    let mut value = ptr::null_mut();
    unsafe {
        if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut value) == 0 {
            return None;
        }
        let stored = &*value;
        let result = if stored.CredentialBlobSize == 0 || stored.CredentialBlob.is_null() {
            None
        } else {
            String::from_utf8(
                slice::from_raw_parts(stored.CredentialBlob, stored.CredentialBlobSize as usize)
                    .to_vec(),
            )
            .ok()
        };
        CredFree(value.cast::<c_void>());
        result
    }
}

pub fn write(target: &str, token: &str) -> Result<(), String> {
    if token.len() > 2560 {
        return Err("访问令牌过长。".into());
    }
    let mut name = wide(target);
    let mut bytes = token.as_bytes().to_vec();
    let mut value: CREDENTIALW = unsafe { std::mem::zeroed() };
    value.Type = CRED_TYPE_GENERIC;
    value.TargetName = name.as_mut_ptr();
    value.CredentialBlobSize = bytes.len() as u32;
    value.CredentialBlob = bytes.as_mut_ptr();
    value.Persist = CRED_PERSIST_LOCAL_MACHINE;
    let success = unsafe { CredWriteW(&value, 0) };
    bytes.fill(0);
    if success == 0 {
        Err("无法将访问令牌保存到 Windows 凭据管理器。".into())
    } else {
        Ok(())
    }
}
