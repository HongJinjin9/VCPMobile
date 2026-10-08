# Tauri 2.12：Android 构建与 JNI 评估

> 评估日期：2026-10-08。当前结论来自本仓生产代码、安装工具链与官方版本源码；构建和运行结果由主代理统一补录。本文件不将源码兼容判断写成构建通过或设备验证。

## 1. 结论与最小迁移

Android 源码评估未发现阻止升级 Tauri 2.12.0 的问题。先保留现有 Android 工具链，只同步 Tauri 依赖并迁移两个自有 Gradle 脚本的 Kotlin 编译选项。最终以升级后的依赖解析、Android Rust 编译、Kotlin 编译、插件 JVM 测试及 Debug APK 构建结果决定是否接纳。

已实施的局部修改：

| 文件 | 修改 | 保持的行为 |
| --- | --- | --- |
| `src-tauri/gen/android/app/build.gradle.kts` | 引入 `JvmTarget`，将 `android.kotlinOptions` 改为顶层 `kotlin.compilerOptions` | JVM 1.8、应用标识、Debug 后缀、签名门禁、SDK、打包规则 |
| `src-tauri/plugins/vcp-mobile/android/build.gradle.kts` | 同样迁移 `compilerOptions` | JVM 1.8、NDK 29、arm64 过滤、C++ 参数、插件依赖 |

这两处编辑已通过 `git diff --check`，尚不能据此判定 Gradle 配置或 Android 构建成功。不执行全量 `tauri android init` 覆盖既有工程，不手工编辑 `tauri.build.gradle.kts` 或生成的 Kotlin 文件。

## 2. 工具链为何保持现状

| 项目 | 当前项目/本机值 | 升级评估 |
| --- | --- | --- |
| Gradle Wrapper | 8.14.3，既有官方 URL/SHA | 满足 Tauri 2.12 声明的最低 8.13 |
| AGP | 8.11.0，根工程与 `buildSrc` 一致 | 本轮不引入 AGP 9 DSL 与行为迁移 |
| Kotlin Gradle Plugin | 1.9.25 | 官方说明新的 `compilerOptions` 同时适用 1.9.x 和 2.x；实际配置仍待执行验证 |
| JDK | 17.0.10 | 当前已安装的 Android 构建 JDK |
| compileSdk / targetSdk | 36 / 36 | Tauri 2.12 Android 运行库本身仍以 compileSdk 36 构建 |
| minSdk | 26 | 应用产品边界不变；高于 Tauri Android 库的 minSdk 21 |
| NDK | 29.0.14206865 | 本机已安装，插件现有固定值不变 |
| Android ABI | arm64-v8a / aarch64-linux-android | 构建命令明确选择 aarch64 |
| Java / Kotlin 字节码 | 1.8 | 本轮 DSL 改写不提高字节码目标 |

Tauri 2.12 新工程模板默认采用 Gradle 9.6.1、AGP 9.3.1、Kotlin 2.2.10、compileSdk/targetSdk 37。这些模板默认值不等同于现有项目接入 Tauri 2.12 的最低要求；官方运行库构建脚本仍使用 `com.android.library`、`org.jetbrains.kotlin.android`、compileSdk 36 和 JVM 1.8。本轮先验证现有兼容组合，避免把应用框架升级同时扩大为 Android 工具链主版本迁移。

依据：[Tauri 2.12 发布说明](https://tauri.app/release/tauri/v2.12.0/)、[运行库 Android Gradle 配置](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.0/crates/tauri/mobile/android/build.gradle.kts)、[新工程 app 模板](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.0/crates/tauri-cli/templates/mobile/android/app/build.gradle.kts)、[上游模板升级 PR](https://github.com/tauri-apps/tauri/pull/15828)。

## 3. JNI 与生成代码必须一起核对

当前生产源码只有两处直接进入 `with_webview(...).jni_handle().exec(...)`：

- `plugins/vcp-mobile/src/screen.rs::set_manual_screen_owner`：调用 Kotlin `ScreenKeepOnArbiter.setManualRequested`。
- `src/vcp_modules/infra/lifecycle_manager.rs::restart_or_exit_app`：调用现有 Android 重启逻辑 `restart_android_app`。

Tauri runtime-wry 2.12.0 声明 wry 0.57.0；官方 wry 0.57.0 仍使用 JNI 0.21，`JniHandle::exec` 参数仍为 `FnOnce(&mut JNIEnv, &JObject, &JObject)`。项目现有 `JNIEnv`、`JObject`、`JValue` 借用类型与之匹配，未发现需要迁移至 JNI 0.22 的依据。最终解析的补丁版本仍须从更新后的 Cargo.lock 和 Android 编译结果确认。

需要更新的是框架生成代码：旧 `TauriActivity.kt` 调用 `PluginManager.onActivityCreate(this)`，并含进程级生命周期 observer；2.12 模板调用 `PluginManager.onCreate(this)`，通过 Activity 的 `onResume`、`onPause`、`onStop` 向插件传入对应 Activity。新版 wry 也按 Activity ID 派发 JNI。只修改 `tauri.settings.gradle` 依赖路径、留下旧 Kotlin 生成文件，会导致新旧框架接口不一致。

应通过正常 Tauri Android Debug 构建，让框架 build script 在 `WRY_ANDROID_*` 与 `TAURI_ANDROID_*` 环境下重新生成 `TauriActivity.kt`、`WryActivity.kt` 等文件，并刷新本地 Tauri Gradle 依赖映射。不得手改生成文件作为修复。本仓的 `TauriActivity.kt` 与 `tauri.build.gradle.kts` 实际受 Git 跟踪，其正常生成差异纳入本次升级；本机绝对路径 settings 被忽略。普通、未带 Android 工程环境的 `cargo check --target aarch64-linux-android` 不能代替这一步。

依据：[runtime-wry 2.12 依赖](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.0/crates/tauri-runtime-wry/Cargo.toml)、[wry 0.57 JNI 依赖](https://raw.githubusercontent.com/tauri-apps/wry/wry-v0.57.0/Cargo.toml)、[wry JNI 实现](https://raw.githubusercontent.com/tauri-apps/wry/wry-v0.57.0/src/android/mod.rs)、[TauriActivity 2.12 模板](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.0/crates/tauri/mobile/android-codegen/TauriActivity.kt)。

## 4. 原生交互与所有者

`MainActivity` 保留系统 SplashScreen、`enableEdgeToEdge` 与硬件返回事件 `vcp-hardware-back`。TauriActivity 的 `handleBackNavigation = false` 在新版本中仍保留，不会因框架升级主动接管现有前端返回链。

项目 `LifecycleBridge` 自己订阅 `ProcessLifecycleOwner`，由插件 `load` 建立、`onDestroy` 清理，继续合并 Activity 切换期间的前后台抖动。它不依赖旧 TauriActivity 中的进程 observer，不应随着上游改用 Activity 回调而改成第二套生命周期状态源。生命周期 nativeSequence、快照与 Rust epoch 的现有契约保持。

屏幕常亮仍由 `ScreenKeepOnArbiter` 仲裁；权限、文件选择与后台服务继续走当前 Kotlin owner。本轮不改这些业务组件。上游修复了 Activity 替换后的权限 launcher 注册与销毁处理，但本仓未取得对应设备操作证据，不能仅凭依赖升级宣称这些场景已在 VCPMobile 实测通过。

## 5. 其余迁移项审计

| 上游变化 | 本仓实际消费者 | 决策 |
| --- | --- | --- |
| 插件 consumer ProGuard 文件修复 | 自家插件没有 `consumerProguardFiles` 声明、缺失的 `.pro` 引用或旧模板 release ProGuard 块 | 不新增无内容规则文件；官方运行库的规则随依赖升级 |
| `video_dir()` / `$VIDEO` 改为 Movies 目录 | 未发现生产调用 | 本轮无需迁移附件存储路径 |
| `JSObject` / `JSArray` 通过 mapper 序列化修复 | 未发现生产代码使用 `resolveObject`、`sendObject`、`triggerObject` 或消费 `nameValuePairs` 旧形状 | 保持现有 DTO 与显式 JSON 返回协议 |
| `AppHandle::exit` 改为关闭 Activity | 当前 Android 重启路径自行调用 JNI、等待后退出进程 | 本轮不重写既有重启行为 |

## 6. 待执行验证与证据边界

以下是本次验证入口，实际结果已由主代理补录；最终依赖为 Tauri 2.12.1：

```powershell
# 仓库根目录：跨层静态检查。
pnpm check

# 仓库根目录：重生框架 Android 代码并构建 arm64 Debug APK。
pnpm tauri android build --debug --apk --target aarch64

# src-tauri/gen/android 目录：编译并运行实际插件 JVM 测试。
.\gradlew :tauri-plugin-vcp-mobile:testDebugUnitTest
```

还需核对实际生成的框架 Kotlin 已对应 Tauri 2.12、Gradle 使用新版运行库路径，并审查 `src-tauri/gen/android` 和插件 permission 生成树的 Git 差异；既有 Android 定制配置不得被模板默认值静默替换。

| 验证项 | 当前状态 |
| --- | --- |
| 两处 Gradle DSL 编辑的 diff 空白检查 | 已通过，仅静态文本检查 |
| 更新后的 `pnpm check` | 2.12.1 已通过 |
| Android Rust / JNI 类型编译 | 最终 2.12.1 实际编译通过；最初 2.12.0 结果仅作排查历史 |
| 框架 Kotlin 重生与编译 | 正常 CLI 生成并编译通过；保留受 Git 跟踪的生成差异 |
| 插件 JVM 测试 | 10 个 suite、62 项通过，0 失败/错误/跳过 |
| arm64 Debug APK | 成功；Debug 包名、debuggable、targetSdk 36 与仅 arm64 已核对 |
| Release 签名构建 | 本轮不读取签名材料，不绕过现有 Release 签名门禁 |
| 设备启动、触控、权限、前后台行为 | 本轮不操作设备，未取得设备证据 |

Debug APK 构建不是安装或发布；源码、编译、JVM 测试和设备行为分别记录。升级评估期间不推进新的 iOS 功能、不修改发布流程、不 push。

最终构建使用下文网络诊断后收束的临时验证配置，完整过程和 APK 哈希见 [最终验证记录](./04-验证结果与遗留问题.md)。临时配置已删除，默认项目仓库保持原状。

## 7. 首次构建遇到的 Maven Central 访问问题

主代理首次实际 Android 构建完成 Rust arm64 编译后，在 `:app:checkUniversalDebugAarMetadata` 解析 Tauri 新增的 `com.fasterxml.jackson.datatype:jackson-datatype-json-org:2.15.3` 时失败。排查结果表明，不能把这次 `Could not find` 当成上游坐标错误：

- 2026-10-08 11:15 UTC，使用具有网络权限的实际 `curl` 请求 Maven Central 官方搜索 API，得到 HTTP 200，`response.numFound = 1`，精确记录为 `com.fasterxml.jackson.datatype:jackson-datatype-json-org:2.15.3`，并列出 `.pom`、`.jar`、`.module`、sources 与 javadoc。该版本已发布。
- 官方 `repo.maven.apache.org` 与 `repo1.maven.org` 的模块请求失败；已知存在的 `jackson-databind:2.15.3` 作为控制请求，也在两个入口返回 HTTP 404。
- 这些 404 的响应为 `Server: cloudflare`、`Content-Type: text/plain`、`Content-Length: 1`、`Retry-After: 56920`（另一入口为 56919 秒），并带 `no-store/no-cache`。结合控制请求和搜索 API 结果，判断是当前网络出口遭遇官方 CDN 访问限制，不是 Maven 中缺少该版本。具体 CDN 限制规则未获确认。
- 安装的 Tauri 2.12.0 真实 Kotlin 源码导入 `com.fasterxml.jackson.datatype.jsonorg.JsonOrgModule` 并注册至 `ObjectMapper`，因此不能通过删除依赖跳过此问题。官方 2.12.1 也使用相同有效坐标，升级补丁版本不会消除此访问限制。

证据入口：[Maven Central 精确版本搜索 API](https://search.maven.org/solrsearch/select?q=g%3Acom.fasterxml.jackson.datatype%20AND%20a%3Ajackson-datatype-json-org%20AND%20v%3A2.15.3&rows=1&wt=json)、[官方 JsonOrgModule 用法](https://github.com/FasterXML/jackson-datatypes-misc/tree/2.15/json-org)、[Tauri 实际 mapper 注册](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.0/crates/tauri/mobile/android/src/main/java/app/tauri/plugin/PluginManager.kt)。

保留依赖坐标、版本与默认官方仓库配置，不添加 dependency substitution，不改 Cargo registry，不持久化额外镜像或取消校验。官方访问恢复后，可先在 Android 工程目录重新解析失败任务，刷新此前 404 造成的 Gradle 负缓存，再重新执行完整 Tauri Debug 构建：

```powershell
.\gradlew :app:checkUniversalDebugAarMetadata --refresh-dependencies
```

截至该次排查，尚未取得完整 Debug APK、升级后的插件 JVM 测试或设备证据；本节只记录依赖解析失败的归因与恢复入口。

### 7.1 可供一次本地验证的临时来源

随后核对了 Google Cloud 托管的公开 Central 镜像。Google 官方博客曾介绍该镜像，但[镜像主页](https://storage-download.googleapis.com/maven-central/index.html)明确说明它不是 Google 正式支持的产品，不能将其描述为受官方支持的 Maven Central 服务。

2026-10-08 11:16–11:17 UTC，对相同 `jackson-datatype-json-org:2.15.3` 的 POM GET 与 JAR HEAD 在 `https://maven-central.storage-download.googleapis.com/maven2/` 均获得 HTTP 200：

| 文件 | 大小 | 镜像返回的原始 SHA-1 元数据 |
| --- | --- | --- |
| POM | 2401 字节 | `d935ed6215d021b39517504a8f214f1a2d8ada9e` |
| JAR | 18224 字节 | `c52f684e509c501fa7e20635067b6b1b0deebfa5` |

这进一步确认了坐标本身有效。以上只是 HTTP 与元数据结果；HEAD 请求不等于已经下载 JAR 并验证其内容哈希。

主代理随后使用这一来源继续本地验证。只放行模块及直接父 POM 时，解析继续在其父级 `jackson-base` 处失败，因此从实际 POM 和 Gradle module metadata 追踪完整必要闭包。临时 init 脚本改为 `exclusiveContent` 加精确版本列表，使这些坐标在本次运行中统一取自镜像，避免继续命中 Central 的失败元数据；其他坐标仍使用原有仓库。

| 用途 | 精确坐标 |
| --- | --- |
| 新模块 | `com.fasterxml.jackson.datatype:jackson-datatype-json-org:2.15.3` |
| 直接父 POM | `com.fasterxml.jackson.datatype:jackson-datatypes-misc-parent:2.15.3` |
| 基础父 POM | `com.fasterxml.jackson:jackson-base:2.15.3` |
| Jackson BOM | `com.fasterxml.jackson:jackson-bom:2.15.3` |
| Jackson 公共父 POM | `com.fasterxml.jackson:jackson-parent:2.15` |
| 父链终点 | `com.fasterxml:oss-parent:50` |
| 现有 Jackson 核心依赖 | `com.fasterxml.jackson.core:jackson-core:2.15.3` |
| 现有 Jackson 映射依赖 | `com.fasterxml.jackson.core:jackson-databind:2.15.3` |
| 现有 Jackson 注解依赖 | `com.fasterxml.jackson.core:jackson-annotations:2.15.3` |
| core/databind POM 导入的 BOM | `org.junit:junit-bom:5.9.2` |

这是源路由范围，不是新增业务依赖列表。`org.json:json:20230227` 继续被上游 Tauri 排除，不进入 Android 包；JUnit BOM 不引入 JUnit 运行 JAR。没有修改源码依赖、默认仓库或 Gradle 校验方式。临时脚本仅匹配本项目路径，结束后移除注入，并在最终验证记录中说明使用的来源。

Tauri `android build -- <ARGS>` 把额外参数交给 Cargo，不能借此传递 Gradle `--init-script`。直接执行 Gradle 时可用 `-I`；完整 Tauri CLI 验证若需临时 init，应由外层执行脚本管理其建立与清理，不把镜像写进 tracked Gradle 文件或用户长期配置。

### 7.2 最终验证方式

上述十坐标方案只完成 AAR 元数据验证，随后运行 JAR 仍受同一 Central 限制。最终临时 init 仅对本工作区将已有 Central URL 路由至该镜像，Google Maven/JitPack 保持；先解析 Debug compile/runtime/unit-test 全部外部制品（32 个 classpath、197 个文件），再完成完整 CLI APK 与 62 项 JVM 测试。为避开本机 C 盘 registry 与 G 盘工程导致的 Kotlin 增量缓存异常，仅该次禁用 incremental；Robolectric 的独立 SDK 下载也使用相同临时镜像。所有 tracked 依赖版本、仓库配置和 Gradle 属性保持前文审定值。
