# 06. 安全、隐私与用户自签产物

> 2026-10-07 修订：沿用 D8/D13 的实验性未签名产物路线，明确设备构建、包结构和用户签名输入。

## 2026-10-07 当前安全与分发裁决

### 产物路线

Tauri CLI 2.11 的[发布说明](https://v2.tauri.app/release/tauri-cli/v2.11.0/)增加了 `--no-sign` 和 `--archive-only`。G2 阶段验收在 GitHub Actions 中执行锁定 CLI 的 device release 构建：

```text
pnpm tauri ios build --target aarch64 --archive-only --no-sign --ci
```

首个用户产物从该 device archive 提取，按 D8 作为 Android Release 的实验性附属资产。G1 debug 接入检查及按需 Simulator 诊断统一见 07；实施发布时遵守仓库的明确发布授权规则。

```text
device .xcarchive / Products / Applications / <Product>.app
  → Mach-O 平台、动态库、资源与 plist 检查
  → <Product>.app.zip
  → Payload/<Product>.app → <Product>.unsigned.ipa
  → manifest + SHA-256
  → 用户配置最终 Bundle ID、身份与 profile → 签名安装
```

`.app.zip` 为必选资产，`.unsigned.ipa` 在 Payload 结构检查完成后附带。用户取得签名身份/profile 并选择外部签名工具；项目负责清晰的输入结构、所需 entitlement 清单和 Bundle ID 改写说明。

### 签名输入的源码依据

以 [zsign v1.1.2 `zsign.cpp`](https://github.com/zhlynn/zsign/blob/v1.1.2/src/zsign.cpp) 为具体研究样本：入口支持目录/ZIP，解包后调用 `SignFolder`，输出 IPA 以 Payload 为根归档。[`bundle.cpp`](https://github.com/zhlynn/zsign/blob/v1.1.2/src/bundle.cpp) 读取 Info.plist 与 executable，处理 profile、嵌套代码和资源封印；[`macho.cpp`](https://github.com/zhlynn/zsign/blob/v1.1.2/src/macho.cpp) / [`archo.cpp`](https://github.com/zhlynn/zsign/blob/v1.1.2/src/archo.cpp) 包含新增签名空间及 `LC_CODE_SIGNATURE` 的路径。这些源码给出了预编译 unsigned bundle 的实际处理机制。

Apple [TN3125](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)用于核对签名者、App ID、设备、期限与 entitlement 的配套；[签名格式说明](https://developer.apple.com/documentation/xcode/using-the-latest-code-signature-format)用于核对资源封印和嵌套签名。Apple 官方工具的支持范围与第三方工具的实现能力分别按对应来源记录。

具体包检查：device Mach-O 的平台标记为 iOS，CPU 为 arm64；Simulator 即使也是 arm64 也使用不同平台标记。主 executable 与 `CFBundleExecutable` 对应；嵌套 framework/dylib 的加载路径完整；压缩保留可执行权限和符号链接；Payload 下仅包含预期 app；签名凭据由用户提供。

### Bundle、最低系统与版本

- CI 候选 Bundle ID 为 `com.vcp.avatar`；沿用 D13，用户签名时可以改写。
- 改写 `CFBundleIdentifier` 与 `BGTaskSchedulerPermittedIdentifiers` 后，选择或生成匹配最终 App ID 的 profile，并按其授权设置 application-identifier、team/keychain 等 entitlement；profile 本身由 Apple 签发。Swift 从 `Bundle.main.bundleIdentifier` 构造 runtime task ID，并校验与 plist 一致。
- Info.plist 留旧 task 前缀而只改 runtime ID，会导致注册/提交不匹配；把该情形列入打包检查与用户说明。
- minimumSystemVersion 显式配置，当前候选 `15.0`；根据锁定框架和实际采用 API 的 deployment target 要求确定。iOS 26 continued API 使用 availability 分支。
- 版本保持与 `package.json` / `Cargo.toml` 一致，build version 单独由产物脚本生成并检查格式。
- Xcode/SDK 组合从 runner 实际库存选择，记录路径与版本；框架 Scene 适配随该组合核对。

### 当前安全接入任务

1. `capabilities/default.json` 对 main 与 `vcp-portal-*` 授权 `vcp-mobile:allow-all`，且无平台限制；
2. `tauri.conf.json` 仍为 `csp: null`、asset protocol scope `["**"]`；
3. iOS 会落入假权限、假设备数据和空成功；
4. Android APK updater 在共同 UI/Rust owner 中全平台可达；
5. API key、sync token、admin/distributed secrets 仍整体序列化进 SQLite settings 并返回前端；
6. Distributed 原生工具可让远程 Agent 触达 clipboard、notification、location/telemetry；
7. `.gitignore` 尚无 `*.p12`、`*.p8`、`*.mobileprovision` 等 Apple secret 防护。

与当前适配直接相关的改动：

- Android/iOS capability 按消费者列举，portal 按自身用途授权；
- Updater、Root、helper、listener、install、CLI/PTY 按平台归属接到 Rust owner 和 UI；
- host scaffold 与 iOS adapter 使用各自 cfg；
- Apple 凭据加入 ignore，unsigned CI 使用只读仓库权限；
- CSP/asset scope 的改动按真实资源流收敛，保留消息 DOM、受控 HTML 和附件渲染；
- SQLite 中敏感配置的 Keychain/受保护 owner 迁移作为既有 P1 问题单独评估，列出读取方、备份/登出与迁移路径。

### Info.plist 与 entitlement 纪律

每项平台声明对应一个已规划功能及调用者，记录声明到代码的映射。

首期核心：

- `NSLocalNetworkUsageDescription`（D7 用户 LAN 服务）；
- 收窄的 `NSAllowsLocalNetworking`（只影响对应 Apple URL Loading System 场景）；
- 显式 minimum system；
- continued task 的 permitted identifiers 与 processing mode，按 04 实现。

条件项：

- Camera/Microphone/Photo add-only/Location/Motion 的 usage description；
- Share Extension 才加 App Group 和第二 Bundle ID/profile；
- APNs 才加 `aps-environment`；
- 普通 TCP LAN 使用用途说明，Bonjour/multicast 随对应发现/多播功能声明；
- Document Picker 的 security-scoped 访问与应用自己的 iCloud container 分别按功能配置；
- 当前 Chat 使用网络/CPU，后台 GPU 等资源随真实计算需求另行声明。

每项功能分别填写签名 entitlement、Info.plist 描述和运行时授权结果，三者与调用链一起检查。

### PrivacyInfo.xcprivacy

先从源码列出文件时间、时钟、磁盘等实际调用及用途，选择对应 required reason；打包后再对照依赖 manifests、符号和 privacy report 补齐。

当前候选：

| Required Reason 类别 | 候选用途 | 核对动作 |
|---|---|---|
| File Timestamp | app container 内 CAS、同步、缓存清理；外部 picker URL metadata | 只声明最终实际使用的 Apple reason |
| System Boot Time | Rust/Tokio monotonic time 可能落 `mach_absolute_time` | 以 Apple 链接产物确认 |
| Disk Space | 下载/写入前决策或用户可见容量 | 沿实际 capacity 调用选择用途 |
| User Defaults / Active Keyboards | 从框架和业务调用中查找 | 找到使用方后登记 reason |

数据清单记录 Chat/Diary/Mail、附件、日志、标识符等实际传输目的地与用途；追踪字段从业务及依赖调用核对。未来进入 App Store 时复用这份清单生成渠道要求的隐私标签。

参考 [Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files) 与 [required reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)。

### 图标、导出合规与凭据

- iOS AppIcon 从现有高分辨率源生成，核对尺寸、alpha/background 和 asset catalog；
- 使用 `rustls` 的加密能力记录在依赖清单，未来 App Store export-compliance 按实际用途填写；
- 构建 job 使用 `contents: read`；附加 Release 资产的 job 在执行发布时单独取得最小写权限；
- 用户签名材料留在用户签名环境，工程产物包含声明与资源。

### 后续渠道

本轮目标为实验性用户自签资产。未来若选择 TestFlight/App Store，另行规划：

- Xcode/SDK 当期上传要求；
- 合法 signing/provisioning 与最终 entitlements；
- archive privacy report、nutrition label、privacy policy、账户/数据删除说明；
- 相应渠道的功能与 release-build 检查；
- App Review 对完整性、Android 文案、下载代码、远程原生工具和后台模式的审查。

当前交付说明写明产物版本、目标系统、包结构、用户签名步骤和具体已知问题，供使用者按所选签名环境处理。
