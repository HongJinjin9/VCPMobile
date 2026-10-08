# Phase 0：依赖目标与 Apple 工程输入审计

> 审计日期：2026-10-08。基线 HEAD：`4c6e25bba72a9883f4c5270c1daf2493850bd04e`。输入为本次工作树中的生产配置、锁文件、已安装 crate 源码与锁定 CLI tag。本文是源码分析和工程输入清单，不是 Apple 编译结果。

## 1. 本阶段结论与证据范围

- Rust、Swift 插件装配、主要原生依赖和 CLI 工程路径已有可定位的施工依据，可以进入 Phase 1。
- 将 **iOS/iPadOS 15.0 作为实施基线**：已读框架声明未发现高于 15.0 的最低要求；Phase 2 显式统一配置、Swift package 和编译环境，Phase 4/5 新 API 逐项 availability 分层。该结论不声称现有全功能已支持 15.0，也不以未来未执行的编译阻止当前独立任务。
- 最值得优先处理的新增发现是：SwiftPM 的 SwiftRs 解析不受 Cargo.lock 约束；tao 的 Scene 注册与 multiple-scenes gate 耦合；CLI 的 device archive 仍先检查已安装 iOS Simulator runtime；这些分别归 Phase 2 和 G1/G2 工程任务。
- 本轮没有构建、安装 target、运行 Actions、创建 Apple 工程或读取签名凭据。原有 Android 生产路径未在本审计中修改。

本次实际执行（工作目录 `src-tauri/`，均返回 0）：

```text
cargo tree --locked --offline --target aarch64-apple-ios -e features -i libsqlite3-sys
cargo tree --locked --offline --target aarch64-apple-ios -e features -i zstd-sys
cargo tree --locked --offline --target aarch64-apple-ios -e features -i ring
cargo tree --locked --offline --target aarch64-apple-ios -i tao --depth 2
cargo tree --locked --offline --target aarch64-apple-ios -i wry --depth 2
cargo tree --locked --offline --target aarch64-apple-ios -i swift-rs --depth 2
```

这些命令只确认离线依赖解析/feature 输入；没有执行 build script、C/Swift 编译或 Apple 链接。下文 `crate@version/path` 是 Cargo registry 源码相对定位，避免将本机缓存绝对路径作为后续执行依赖。`CLI/…` 对应上游 `tauri-cli-v2.11.4/crates/tauri-cli/…`。

## 2. 固定版本与目标输入

| 对象 | 本次确认值 | 事实源与后续使用方式 |
|---|---|---|
| 应用版本 | `1.1.6` | `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`；旧根规范的 1.1.4 不是当前生产值 |
| JS API / CLI / opener JS | `2.11.1` / `2.11.4` / `2.5.4` | `package.json`、`pnpm-lock.yaml`；CLI 与 Rust patch 不必人为改成相同数字 |
| Tauri Rust / build / plugin-build / utils | `2.11.5` / `2.6.3` / `2.6.3` / `2.9.3` | `Cargo.toml` 声明 + `Cargo.lock` 实际版本；普通 semver 声明由锁文件约束 |
| runtime-wry / tao / wry | `2.11.4` / `0.35.3` / `0.55.1` | Apple target 依赖树及锁定本地源码 |
| SwiftRs Rust crate | `1.0.7` | Apple target 依赖树；不要与 SwiftPM 包解析结果混淆 |
| Rust 工具链 | `1.97.1` | `rust-toolchain.toml`；当前自动安装目标只有 Android |
| 生产 Android | `aarch64-linux-android`，minSdk 26 | 当前 Cargo/Tauri 配置；本次保持 |
| iOS 工程目标 | device `aarch64-apple-ios`；minimum `15.0` | 本阶段施工输入，Phase 2 写入平台配置；Simulator 仅为 Actions 中按需诊断，不增加产品 ABI |
| app Rust 产物 | `vcp_mobile_lib`，`staticlib/cdylib/rlib` | `src-tauri/Cargo.toml`；Apple 工程消费 staticlib |
| 插件 Rust package | `tauri-plugin-vcp-mobile`，`links` 同名 | 插件 `Cargo.toml`；Swift product 必须匹配传给 linker 的名字 |

当前 `src-tauri/build.rs` 的 Windows manifest 参数同时检查 `CARGO_CFG_TARGET_OS=windows` 与 `CARGO_CFG_TARGET_ENV=msvc`，不会按 host 系统误注入 iOS。插件 `build.rs` 目前仅有 `.android_path("android")`；插件 state、handle 和初始化只在 Android 存在，iOS 仍会进入 `not(android)` 的 host 分支。Phase 1/2 必须显式拆分，不能把 host 检查通过理解为已接入 Apple。

## 3. Swift 注册、ABI 与线程边界

| 环节 | 已确认源码条件 | 施工动作 |
|---|---|---|
| build 入口 | `tauri-plugin@2.6.3/src/build/mobile.rs::setup` 先读 `CARGO_CFG_TARGET_OS`，iOS 分支本身由 build-script host `cfg(target_os="macos")` 包含 | 插件 `.ios_path("ios")`；Windows 上读源码/解析依赖不执行该分支 |
| Tauri API 拷贝 | 同函数读 `DEP_TAURI_IOS_LIBRARY_PATH`，将 API 拷贝至 **ios 路径的父目录**下 `.tauri/tauri-api` | 项目实际目录为 `src-tauri/plugins/vcp-mobile/.tauri/tauri-api`；不要误写为 `ios/.tauri` |
| Swift package | `tauri-plugin-opener@2.5.4/ios/Package.swift` 用静态 library，dependency 指向 `../.tauri/tauri-api` | VCP package/product 命名 `tauri-plugin-vcp-mobile`，source target 可沿 opener 约定；用 `.iOS(.v15)` |
| 静态链接名 | `tauri-utils@2.9.3/src/build.rs::link_apple_library` 用 `CARGO_PKG_NAME` 调 `SwiftLinker::with_package`；`swift-rs@1.0.7/src-rs/build.rs` 原样输出 `rustc-link-lib=static={package.name}` | 保留 product 的连字符；Rust C 导出符号使用下划线，两种名字各有消费者，不能统一替换 |
| 初始化符号 | `tauri@2.11.5/src/lib.rs::ios_plugin_binding!` 展开 `swift!(fn …() -> *const c_void)`；`register_ios_plugin` 接收 `unsafe fn() -> *const c_void` | Swift `@_cdecl("init_plugin_vcp_mobile")`、Rust binding 和注册实参三者一致 |
| 插件保活 | `mobile/ios-api/Sources/Tauri/Tauri.swift::PluginManager` 按插件名保存 handle/instance；Rust `register_ios_plugin` 允许有 WebView 或空 WebView 分支 | Swift 插件持有 observer/Channel，Rust domain 继续持有 Chat/Sync/DB；定义替换订阅和清理时点 |
| 命令 selector | 同文件 `invoke` 在 `DispatchQueue(label:"ipc")` 中依次匹配 `command:completionHandler:`、`command:error:`、`command:` | 每个 Rust command 字符串逐一对应 Swift `@objc` selector；不用类名/方法名相似作为证据 |
| UIKit 队列 | IPC 队列不是 UIKit 主队列 | picker、UI presentation、Scene/window 读取明确进入主队列；复制/解码不占用该队列 |
| DTO/Channel | `Invoke.swift::parseArgs/resolve/reject`；`Channel.swift` 解码 `__CHANNEL__:<id>`，支持 Encodable send | Phase 1 先固定 DTO/CodingKeys/错误；Phase 2 注册时回放 snapshot，持有同一有序事件源 |
| 取消风险 | `src/plugin/mobile.rs::run_mobile_plugin_async` 回调 `send(response).unwrap()`，丢弃接收 future 后迟到回调可触发 panic | Phase 2 桥接任务独立接收最终响应，业务取消按 generation 丢弃结果；原生必须形成有界终态，避免无限保活任务 |

**SwiftPM 锁定缺口**：`tauri@2.11.5/mobile/ios-api/Package.swift` 的 SwiftRs dependency 为 `from: "1.0.0"`。Rust `swift-rs 1.0.7` 不能证明 Swift 包也解析到 1.0.7；`swift-rs` 构建器执行 `swift build`，未显式提供只用既有 resolution 的开关。Phase 2 应记录实际 SwiftPM resolved revision、制定可重复的 resolution 输入并让 G1 保存；不要把 `.tauri` 中临时生成的 `Package.resolved` 当作已受版本管理的锁。

## 4. cfg、features、C/FFI 与原生链接输入

| 依赖与实际输入 | 源码分支/输出 | 判断与下一动作 |
|---|---|---|
| `rusqlite 0.39.0`（bundled/limits）+ `sqlx/sqlx-sqlite 0.9.0`（sqlite/runtime/macros/migrate）→ `libsqlite3-sys 0.37.0` | `libsqlite3-sys/build.rs::main/build_bundled` 复制 bundled bindings、编译 `sqlite3/sqlite3.c`；`SQLITE_THREADSAFE=1`、unlock-notify、FTS 等；静态 sqlite3 | 两条运行时消费链汇入同一 crate 版本。树中另一次出现来自 SQLx proc-macro host 图，不能误判为 app 链入两个 SQLite 版本。Phase 3 检查实际 DB 目录、锁、临时文件、迁移和 reopen |
| SQLite target 差异 | `android_target()` 才添加 `SQLITE_TEMP_STORE=3`；iOS 不进入该分支 | iOS 有磁盘临时文件可能，纳入目录与容量/错误处理；不为追求平台相同而盲目复制 Android flag |
| SQLite extension | SQLx `sqlite` 展开 `sqlite-load-extension`；bundled C 明确 `SQLITE_ENABLE_LOAD_EXTENSION=1` | feature 存在不等于当前业务启用；本次在生产持久化入口未找到 `load_extension`/`load_extension_enable`/`.extension(...)` 调用。Phase 3 保持无动态扩展输入，若收窄 feature 需检查宏/运行时消费者 |
| `zstd 0.13.3` → `zstd-safe 7.2.4` → `zstd-sys 2.0.16+zstd.1.5.7` | 实际 feature 为 legacy/std/zdict_builder；无 bindgen。`build.rs` 枚举 common/compress/decompress/dictBuilder/legacy C，`compile("libzstd.a")` | 使用随包 bindings 与 C 源；汇编文件自身宏控制架构，不将 amd64 文件名当成 Apple arm64 必然失败。Phase 3/6 记录真正 C 参数和 archive |
| `reqwest 0.12.28` + `tokio-tungstenite 0.26.2` → `rustls 0.23.40` → `ring 0.17.14` | 实际 rustls provider 为 ring；`ring/build.rs::ASM_TARGETS` 的 aarch64 + APPLE_ABI 选 `ios64`，registry 包使用 pregenerated 汇编；版本化原生符号前缀由 build.rs 与 `prefixed.rs` 配套 | 当前链不因关闭 reqwest 默认 feature 而变成无原生代码；Phase 6 核对 ring 静态 archive/符号，Phase 3 网络仍归 Rust transport owner |
| `cc 1.2.63` | `apple_flags/apple_sdk_root` 处理 SDK 和 target；deployment target 优先环境，再 SDK 默认，再 fallback | 明确设置 `IPHONEOS_DEPLOYMENT_TARGET=15.0`；否则 C 与 Swift/Rust 可得到不同默认值。记录目标专用 CC/CFLAGS/SDKROOT，不能借用 host macOS 编译参数 |
| `htmd 0.5.5` | manifest `build=false`，edition 2024；HTML parser/转换 Rust 依赖 | 无该 crate 自身 C build script；沿 HTML 提取预算审查，不编造 Apple 专用改造 |
| `pdf_oxide 0.3.77` | app `default-features=false`；manifest `build=false`、MSRV 1.88；OCR/GPU/Python 分别为可选 feature | 不能把未选择的 OCR/GPU 成本算入当前产品；本报告未宣称所有 transitive crate 都无原生代码。Phase 3/4 沿实际 PDF 调用处理输入上限/取消 |
| `memmap2 0.9.11` | `src/lib.rs` 选择 unix；`src/unix.rs` 使用 mmap/off_t，Linux flags 受 cfg 控制 | iOS 可定位到 Unix 实现；Phase 3/4 保证映射期间文件不被替换/截断及长度上限 |
| Android JNI/CLI 原生部分 | app/plugin manifest 中 jni 仅 target Android；Android C/C++ 由 Android 工程拥有 | Phase 1 拆 host fallback；不将 Android `.so`、PTY 运行时或 APK 资源加入 Apple 链接 |

环境覆盖需要精确区分：

- `LIBSQLITE3_SYS_USE_PKG_CONFIG` **存在且不等于 `0`**会优先改走系统库；SQLite `loadable_extension` 也改变 build 分支，但当前不是这个 feature。
- `ZSTD_SYS_USE_PKG_CONFIG` 只要**存在**就可能切到 pkg-config，设置成字符串 `0` 也不等价于 unset。
- `RING_PREGENERATE_ASM=1` 改为生成流程，默认应保持未设置；常规 registry 构建不应意外要求 Perl 工具链。
- G1/G2 明确记录 `SDKROOT`、`IPHONEOS_DEPLOYMENT_TARGET`、目标专用 `CC/CFLAGS` 和上述开关的有效值；不输出其他可能含凭据的环境变量。

## 5. minimum 与 Scene 的工程裁决

| 条件 | 本次源码证据 | 处理 |
|---|---|---|
| Tauri Swift API | `tauri@2.11.5/mobile/ios-api/Package.swift` 为 `.iOS(.v11)` | 不要求整体提高到 26 |
| opener Swift | `tauri-plugin-opener@2.5.4/ios/Package.swift` 为 `.iOS(.v13)` | 15.0 高于其 manifest 声明 |
| Tauri 配置和 Swift build | `tauri-utils@2.9.3/src/config.rs::ios_minimum_system_version` 默认 13.0；`src/build.rs` 无环境变量时也 fallback 13.0 | Phase 2 显式固定 15.0，不能依赖默认 |
| 新原生业务 API | Files/PHPicker/ImageIO 与 continued processing 尚未进入生产 Swift 实现 | Phase 4 对最终使用的 API 声明逐项核对；Phase 5 iOS 26 API 只在 availability 分支，旧系统前台回退 |
| Scene 已存在 | `tao@0.35.3/src/platform_impl/ios/scene.rs::TaoSceneDelegate` 已实现；后台/回前台两个 callback 当前为空 | 不能写成“框架完全没有 Scene”；业务 native Channel 仍需自己的事实生产者 |
| 单 Scene 装配缺口 | `scene.rs::multiple_scenes_enabled` 读 `UIApplicationSupportsMultipleScenes`；`view.rs` 仅在 true 时注册 `application:configurationForConnectingSceneSession:options:`，`app_state.rs::did_finish_launching` 也按该函数分流 | D5 单 Scene 不等于把值写 false 后接入自动完成。Phase 2 对首窗口创建、Scene 连接和插件 attach 做分支审计，选择最小修正或经对比的框架版本；不得擅自把产品改成多窗口 |

15.0 是本阶段明确的工程选择。G1 负责实际 toolchain/SDK 下的编译和链接；若某个具体依赖/API 的声明要求更高，定位该 API、给 availability/fallback 或版本调整方案，更新这一行及消费者。无需等待 G1 才能开始 capability/cfg/DTO 工作。

## 6. Apple 模板、资源与签名输入归属

已读取锁定 CLI `project.rs::gen` 与 `templates/mobile/ios/project.yml`：模板经配置生成 Xcode 工程，包含 Sources、Assets.xcassets、Externals、应用 Info.plist/entitlements、LaunchScreen 和资源目录。模板声明 arm64 device、iPhone/iPad 方向、Swift 标准库及 UIKit/WebKit 等 framework，Rust archive 以 `libapp.a` 接入。模板声明只是输入，后续工程改动应可重放。[CLI 工程生成源码](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/mobile/ios/project.rs)、[锁定 project.yml](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/templates/mobile/ios/project.yml)。

`xcode_script.rs` 明确区分 device `aarch64-apple-ios` 与 simulator `aarch64-apple-ios-sim`，使用 Xcode 传入 SDK 并编译 Rust 库；`libapp.a` 为工程输入名称，不能要求更改现有 `vcp_mobile_lib` crate 名来迎合它。[锁定 Xcode script](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/mobile/ios/xcode_script.rs)。

| 输入/输出 | 唯一维护位置或规则 | 阶段 |
|---|---|---|
| Tauri Apple 配置 | 受版本管理的 `src-tauri/tauri.ios.conf.json`；写 minimum、bundle/framework/resource 平台输入 | Phase 2 |
| 插件 Swift | 受版本管理的 `src-tauri/plugins/vcp-mobile/ios/Package.swift`、`Sources/**` | Phase 2/4/5 |
| app plist | 受版本管理的 `src-tauri/Info.ios.plist`；只放功能所需条目 | Phase 2/5 |
| Scene/entitlement/资源装配差异 | 受版本管理的工程 overlay/生成脚本，位于生成树外；Phase 2 确定实际文件名 | Phase 2 |
| `src-tauri/gen/apple/**` | 锁定 CLI 生成后应用 overlay；可重建输出，整体 ignore；人工差异必须回迁到源输入 | Phase 2/G1 |
| `.tauri/tauri-api`、Swift build 缓存 | 生成依赖副本/缓存，不维护生成内容 | Phase 2/G1 |
| SwiftPM resolved revision | 不能由 Cargo.lock 代替；受控输入与 G1 证据均须保存，禁止笼统 ignore 所有 `Package.resolved` | Phase 2/G1 |
| AppIcon | 仓库已存在 `src-tauri/icons/ios/AppIcon-*`；后续复制/生成 Assets catalog 并核对尺寸和 alpha | Phase 2/G2 |
| PrivacyInfo.xcprivacy | 源文件与复制规则在生成树外，最终须检查 bundle 中实际位置；仅出现在目录里不等于已入包 | Phase 2/6 |
| `dist` 与一般 bundle resources | frontendDist 仍为 `../dist`；CLI `inject_resources` 负责配置中的资源拷贝，不能把隐私清单正确位置交给猜测 | Phase 2/G2 |
| 用户签名材料 | 用户环境拥有；不放仓库/unsigned 构建输入 | Phase 6 |

CLI build 按顺序合并生成 Info.plist、版本值、根 `Info.plist`、`Info.ios.plist`、显式 `bundle.iOS.infoPlist` 等；因此 Phase 2 避免在多个源文件写同一个 key。`--archive-only --no-sign` 先得到 archive 后直接返回；未使用 archive-only 的 no-sign 模式另有 create_ipa 路径。本项目沿 D8 仍从 archive 检查并制作 `.app.zip`/条件性 `.unsigned.ipa`，不把签名/export 设为构建前提。[CLI build 合并与 archive 分支](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/mobile/ios/build.rs)。

**G1/G2 容易漏掉的前置项**：同一 `build.rs::run` 在非 `--open` 时调用 `ensure_ios_runtime_installed()`；`ios/mod.rs` 通过 `xcrun simctl list runtimes --json` 检查 iOS runtime 名称。因此 device archive 也要求 runner 已安装 iOS runtime。这是锁定 CLI 的预检查依赖，不增加固定 Simulator 旅程。Phase 2 工程准备记录 runner 库存，G1/G2 再核对实际安装状态。[CLI iOS 环境预检查](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/mobile/ios/mod.rs)。

本轮 ignore 应精确覆盖：

```gitignore
/src-tauri/gen/apple/
/src-tauri/plugins/vcp-mobile/.tauri/
/src-tauri/plugins/vcp-mobile/ios/.build/
/src-tauri/plugins/vcp-mobile/ios/.swiftpm/
*.p12
*.p8
*.mobileprovision
*.provisionprofile
```

保留配置源、Swift 源、plist、xcprivacy、entitlements 和受控 resolution 输入可追踪；不使用 `*.plist`、`*.swift`、`*.entitlements` 之类宽泛规则。最终 Bundle ID、task identifier 前缀及 entitlement 改写仍按 D13 由 Phase 6 打包和用户签名说明联动。

## 7. 具体后续任务与完成判据

| ID | 状态与具体问题 | 实施 owner / 阶段 | 闭环证据 |
|---|---|---|---|
| DEP-01 | 已定位：iOS 落入 host fallback，插件缺 Swift handle | capability/cfg / Phase 1；plugin / Phase 2 | iOS/Android/host 分支和每个调用结果一致 |
| DEP-02 | 已确定：product 保留连字符、导出符号用下划线 | Swift package/FFI / Phase 2 | product、静态库名、`init_plugin_vcp_mobile`、binding/注册四项对应；G1 符号/链接 |
| DEP-03 | 已定位：SwiftPM SwiftRs 未由 Cargo.lock 锁定 | 工程生成 / Phase 2 | resolution 输入、resolved revision 与 G1 日志对应 |
| DEP-04 | 已定位：单 Scene 目标与 tao multiple-scenes gate 耦合 | framework 接入 / Phase 2 | 首窗口/Scene/attach 调用链及最小修正；G1 工程检查 |
| DEP-05 | 已定位：取消 native future 可触发上游 send unwrap | native bridge / Phase 2 | bridge task 最终接收、generation 丢弃和资源回收分支 |
| DEP-06 | 已确定输入：15.0，生产配置尚待 Phase 2 写入 | Apple build / Phase 2 | Tauri 配置、环境、Swift manifest 与 G1 最低系统输入一致 |
| DEP-07 | 已确定 feature：SQLite extension 编入；无已找到业务调用 | persistence / Phase 3 | 不新增动态扩展入口；SQLite temp/锁/容量路径明确 |
| DEP-08 | 已定位：zstd/sqlite pkg-config 覆盖条件不同 | 构建环境 / Phase 2/6 | 三个原生库的真实 flags、SDK 与静态链接输入 |
| DEP-09 | 已定位：device archive 也有 runtime 预检查 | Actions 输入 / Phase 2/G1/G2 | 固定 runner/Xcode/SDK/runtime 库存；不触发额外常规测试体系 |
| DEP-10 | 尚需实施：plist/Scene/privacy/AppIcon overlay 可重复性 | 工程生成 / Phase 2 | 干净生成树可重放，源文件和最终 bundle 检查对应 |
| DEP-11 | 尚需细化：最终选用的 Files/PHPicker/26 API availability | Swift adapter / Phase 4/5 | 每个实际 API 声明、最低版本、旧版本结果与错误分支 |

本表中“尚需实施”均是有明确接入位置的后续任务。Phase 0 的依赖审计以完成输入定位和任务交接为完成条件；Apple 产物验证在已约定的 G1/G2 取得，并按具体诊断回到上述 owner 修复。
