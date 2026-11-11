# Android 构建与签名

Android 预览版支持 Android 8.0+、ARM64。原生实现位于 src-tauri/mobile/android，Gradle 工程位于 src-tauri/gen/android。不要反复执行 android init 覆盖已维护的 Gradle 配置。

## 构建

需要 Node.js 22.18+、Rust stable、JDK 21、Android SDK command-line tools，以及以下 SDK 包：

```sh
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.2.12479018"
rustup target add aarch64-linux-android
npm ci
npm run android:build
```

Windows 构建时 Tauri 需要创建符号链接，请先启用 Windows 开发者模式。未启用时原生编译可能成功，但在链接 jniLibs 阶段失败。

先把 JAVA_HOME 指向 JDK，ANDROID_HOME 指向 SDK，NDK_HOME 指向 SDK 下的 ndk/27.2.12479018。这些路径保存在本机环境，不能提交 local.properties。

调试构建可用 `npm run tauri -- android build --target aarch64 --apk --debug`。APK 输出在 src-tauri/gen/android/app/build/outputs/apk 下。调试包与发布包签名不同，不能相互覆盖安装。

## 发布签名

Gradle 从环境读取以下字段；不设置时 release 产物没有可安装的发布签名：

| 环境变量 | 含义 |
| --- | --- |
| FOLIO_KEYSTORE_PATH | 密钥库绝对路径，放在仓库之外 |
| FOLIO_KEYSTORE_PASSWORD | 密钥库密码 |
| FOLIO_KEY_ALIAS | 签名密钥别名 |
| FOLIO_KEY_PASSWORD | 签名密钥密码 |

使用同一签名和递增版本发布后续 APK，才能保留应用数据覆盖升级。私钥必须自行离线备份，不能放进 Git、Issue 或 Release 附件。公开源码不包含项目发布密钥，贡献者需要自己的调试或发布签名。

## 原生服务

- SAF 选择器取得只读、可持久化 URI 权限，以 saf:/UUID 路径供共享层访问。
- 原位置文件不复制。克隆使用应用 filesDir/repositories，24 MB 以内的单个文档/资源可读取。
- 令牌使用 Android Keystore 的 AES-GCM 密钥加密，应用备份关闭，避免恢复无法解密的凭据。
- HTTPS API 请求使用系统 HttpURLConnection 和系统证书库，禁用自动重定向。
- JGit 执行深度 1 的 HTTPS 克隆。前台进度可见，取消/失败后清理应用自建临时目录。下次启动也清理被终止的未完成任务。
- 不申请全部文件访问权限，不创建独立窗口，不做后台克隆。

## 验证范围

前端平台测试和模拟视口旋转不等于真机验收。发布前应检查 SAF 文件/文件夹、相对链接和图片、刷新与重启恢复、系统返回键、分屏旋转和重新分页、公开/私有仓库读取、克隆取消/断网重试。企业证书、文档提供器和厂商系统存在差异，请在 Issue 中注明设备与系统版本。
