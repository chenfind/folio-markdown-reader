# Folio 架构

Folio 使用同一份代码维护 Windows 和 Android 版本。共享层负责阅读行为，平台层负责操作系统能力。Android 产品决策见 [Android 端约定](./android-requirements.md)。

## 模块职责

| 位置 | 职责 |
| --- | --- |
| src/core | 阅读锚点、标签与分屏的数据模型，以及现有持久化格式 |
| src/documents | 文档地址解析、文件树、内置文档和文档读取入口 |
| src/repositories | 远程仓库配置、按提交的目录缓存、连接和克隆界面 |
| src/reader | Markdown 渲染、资源解析、阅读位置、分页和正文样式 |
| src/app | 会话、文档库、阅读设置、分屏策略和独立窗口流程 |
| src/platform | 浏览器与原生平台能力、文件服务、仓库接口、外部链接和窗口实现 |
| src/app/components/MobileReaderUI.vue | 手机独立触屏外壳、底部操作与文档列表，复用共享会话 |
| src/reader/interaction.ts | 控件与实际滚动识别、阅读手势判定 |
| src/App.vue | 组装界面、菜单、拖拽及共享交互 |
| src-tauri/src/repositories.rs | GitHub / GitLab 读取协议与提交解析 |
| src-tauri/src/repository_url.rs | 仓库地址校验 |
| src-tauri/src/platform | 平台识别、凭据服务和克隆实现的分派 |
| src-tauri/src/platform/windows_* | Windows Credential Manager 和本机 Git |
| src-tauri/src/platform/android.rs | 原生 Android 插件桥接和系统 HTTPS 请求适配 |
| src-tauri/mobile/android | SAF 文件授权、Keystore、JGit 前台克隆 |
| src-tauri/gen/android | 可重现的 Android Gradle 应用工程 |

## 平台入口

main.ts 在挂载 Vue 前初始化平台。浏览器选择浏览器文件导入适配器，原生应用通过 runtime_platform 命令识别操作系统。不能用 isTauri() 判断是否拥有桌面文件路径、系统 Git 或独立窗口。

业务模块通过 getPlatform() 使用 FileAccess、RepositoryAccess 和 ReadingWindows。Tauri 的系统 API 依赖集中在 src/platform 中。新增原生系统能力应先定义接口和平台能力，再提供适配实现。

Android 的普通文件 URI 不能直接传给桌面 readFile。Android 适配器将 saf:/UUID 文档 ID 映射到持久授权的 URI，在自己的服务内完成读取和列目录。

## 阅读与界面

文档服务提供 UTF-8 内容和内容哈希。Markdown 渲染器接收资源读取函数，返回 HTML、目录和对象 URL。阅读组件负责释放 URL，过期渲染结果也要释放。

会话管理独立于操作系统窗口。分屏方向由平台策略决定，Windows 使用用户选择，Android 根据视口决定。分页重排继续使用内容锚点。

独立窗口流程位于 useReadingWindows，原生创建、聚焦和关闭位于平台适配器。Android 会在能力入口和行为入口同时禁用独立窗口。

## 持久化兼容

保留 folio: 前缀和现有键名，包括 settings、roots、expanded、layout:main、layout:reader-*、position:* 和 remote-repositories。保留 demo:/、import:/、remote:/、Windows 路径及 UNC 路径的现有解析规则。

浏览器导入仍是本次选择的 File 对象，刷新后需要重新选择。本地原生文档仍从原位置读取。远程仓库按提交读取，刷新后才切换提交。

令牌保留在 Windows Credential Manager 中。本次重构保持原有凭据目标名称和 Rust 命令名称，避免丢失已有授权。

跨 Windows 窗口传递标签的 localStorage 通道只属于独立窗口流程。移动端阅读位置和配置可以继续沿用持久化格式，后续持久化后端替换应在 core/persistence 中迁移。

## Rust 平台边界

远程协议模块不执行 git 命令，不直接调用 Windows 凭据 API。它依赖平台凭据服务。

Windows 的克隆适配器继续校验通过目录选择器授权的位置。Android 使用应用内 JGit，遵循 Android 端约定中的临时目录和重试规则。

HTTP 的查询和状态处理共享。Windows 继续使用 native-tls，Android 通过 HttpURLConnection 使用系统证书信任库。Android 的企业证书、网络和凭据行为仍需专项验证。

## 检查

- npm test 检查平台能力、Android 分屏方向和现有文档路径规则。
- npm run build 检查类型并构建界面。
- cargo check --manifest-path src-tauri/Cargo.toml 检查本机 Rust 实现。
- 阅读行为回归应覆盖打开、相对链接、刷新、分页、跨篇、设置、分屏，以及 Windows 的弹出和移回。
- Android 规则的单元测试不能替代 APK 和真机验证。

## 管理副本和源码查看（0.2.3）
RepositoryAccess 新增 inspectClone/updateClone，并由平台层执行；Windows 额外支持显式接管旧 Git 文件夹。管理归属以原生记录为准，不能仅凭前端 sourceKind 标签认定可覆盖。Windows 在应用数据目录登记受管路径，使用同级临时目录、备份和持久事务记录完成切换，中断后恢复旧副本；Android 以文档授权记录指向快照目录，稳定 saf ID 不随快照变化。在线来源继续沿用 remote:/ ID 和按提交读取方式。克隆配置不保存令牌。

SourceViewer 是独立的应用内只读界面，复用文档读取和 Markdown 渲染，不改变阅读会话。解析器在块上写入 data-source-start/end（零基行范围，结束不含）；sourcePosition 提供范围插值和可见块定位。源码和对照正文使用明确的用户输入主导方向，避免同步滚动反馈环。关闭时释放资源 URL、观察器和事件监听。
