# Tauri 2.12.1：Rust 与 IPC 评估

核查日期：2026-10-08。当前任务为暂停 iOS 后的框架升级评估；既有 Phase 2 工作保留。基础源码审查覆盖 2.12.0，随后完成第 7 节的 2.12.1 补丁审查并采用后者。本文件记录源码审查，不把 host 编译、单元测试或 Android 构建表述为 iOS 运行证据。

## 1. Melchior 结论

**Rust/IPC 层没有发现阻止升级到 Tauri 2.12.1 的接口变化。** 可以按下表同步升级，保留现有中央命令 offload、状态 owner、原生 receiver 保活和一次长期 Channel。实际落地仍需主任务完成两份 lockfile 更新、host 检查和 Android 验证；此前在 2.12.0 上取得的静态/测试结果不能挪作 2.12.1 的执行结果。

| 输入 | 升级前 | 本次目标 | 处理 |
| --- | --- | --- | --- |
| 应用与 workspace `tauri` | 2.11.5 | 2.12.1 | 同步两处声明 |
| 应用 `tauri-build` | 2.6.3 | 2.7.1 | 独立版本线 |
| 本地插件 build dependency `tauri-plugin` | 2.6.3 | 2.7.1 | 与新构建辅助库对齐 |
| npm API | 2.11.1 | 2.12.1 | 保留原有调用者 |
| npm CLI | 2.11.4 | 2.12.1 | 与 Rust 核心同步 |
| `tauri-runtime` / `tauri-runtime-wry` | 由旧 lock 固定 | 2.12.1 系列 | 作为传递依赖解析，不新增 direct dependency |
| `tauri-utils` | 由旧 lock 固定 | 2.10.1 系列 | 同上 |
| `tauri-macros` / `tauri-codegen` | 由旧 lock 固定 | 2.7.1 系列 | 同上 |
| tao / wry | tao 本地 0.35.3 补丁 | 官方 tao 0.37 / wry 0.57 | 撤销 tao override，具体 Scene 审查由 iOS 评估记录承接 |
| opener Rust/npm | 2.5.4 | 保持 2.5.4 | 已发布 Rust manifest 允许 tauri `2.10`、tauri-plugin `2.5` 兼容范围 |
| log Rust | 2.9.0 | 保持 2.9.0 | 同样允许上述 Tauri 范围，无前端配对包 |

基础版本对应关系直接核对官方 [2.12.0 workspace manifest](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/Cargo.toml) 与 [runtime-wry manifest](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri-runtime-wry/Cargo.toml)；最终配套版本进一步核对 [2.12.1 workspace manifest](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/Cargo.toml)、[API manifest](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/packages/api/package.json) 与 [CLI manifest](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/packages/cli/package.json)，没有仅依赖 changelog。插件兼容范围另核对本机 Cargo registry 中已下载、对应锁定发布包的 normalized `Cargo.toml`。

## 2. 工具链与依赖边界

Tauri 2.12.0 workspace 使用 edition 2024、MSRV 1.90。本机已记录的 Rust 1.97.1 满足要求；应用和本地插件可继续 edition 2021，不需要为了依赖 edition 迁移业务源码。本地插件原声明 `rust-version = "1.77.2"` 已不能代表新依赖图的最低要求，应修正为 1.90；应用可同时明确相同下限。[官方工具链声明](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/Cargo.toml)

新 Tauri 的 mobile HTTP 依赖为 reqwest 0.13，项目自己的 HTTP owner 仍用 0.12；本项目没有把 reqwest 类型传给 Tauri 公共接口，因此本次不顺带改造业务 HTTP 栈。Cargo 可能同时解析两个 reqwest 版本，这属于依赖图事实，不能据此声称安装包体积不变。Windows WebView2 / windows crate 更新只影响对应构建目标的解析与检查，不构成新增桌面产品支持。[Tauri 目标依赖](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri/Cargo.toml)

Tauri 2.12.0 的 Rust Apple 依赖要求 swift-rs 1.0.8，而既有 SwiftPM exact 为 1.0.7。SwiftPM 不受 Cargo.lock 控制，必须单独核对兼容关系、resolution 与工程断言；Rust crate 和 Swift package 不保证同号发布，不能直接把 Swift exact 改成不存在的 tag。该工作已交接 iOS 评估负责人。[Apple 依赖声明](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri/Cargo.toml)

## 3. 中央 invoke handler 与 State

项目入口为 [commands.rs](../../src-tauri/src/commands.rs) 的 `app_command_handler!`，在 [lib.rs](../../src-tauri/src/lib.rs) 展开。现有 handler 在原线程只检查 main WebView 并转交 `Invoke`，随后在 async worker 构造与分发业务 future。

逐项核对官方 [IPC 源码](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri/src/ipc/mod.rs)：

- `InvokeHandler<R>` 仍是接收 `Invoke<R>`、返回 bool 的 `Send + Sync + 'static` closure。
- `Invoke.message`、`Invoke.resolver` 仍公开，`message.webview()`、`command()` 和 `resolver.clone()/reject()` 的使用方式不变。
- resolver clone 共享单次响应 owner；现有代码只在 `generate_handler!` 返回 false 时使用备用 resolver 拒绝未知命令，未引入第二次响应。
- `InvokeMessage::state` / `state_ref` 被弃用。本项目搜索未找到调用；生产代码继续通过 `Manager::state/try_state` 访问状态。
- 上游明确把 `Invoke` 归为宏内部、非稳定结构。此次按目标 tag 核对通过，仍需实际编译；不能由同属 v2 推导未来小版本无需复核。

官方 [State 源码](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri/src/state.rs) 仍提供现用的 `State<'_, T>`、Deref 和 command 参数取值路径。不需要改写领域状态、添加 Arc 包装层或复制管理容器。

## 4. 原生 PluginHandle 与 Channel

现有 [插件装配](../../src-tauri/plugins/vcp-mobile/src/lib.rs)、[事件订阅](../../src-tauri/plugins/vcp-mobile/src/events.rs) 和 [iOS 接收端](../../src-tauri/plugins/vcp-mobile/src/ios.rs) 与官方 [mobile.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri/src/plugin/mobile.rs) 核对结果：

| 契约 | 2.12.0 事实 | 项目处理 |
| --- | --- | --- |
| `register_android_plugin` / `register_ios_plugin` | 当前所用参数与返回 `PluginHandle<R>` 契约保留 | 不改装配和 state owner |
| `run_mobile_plugin_async` | 序列化请求、oneshot 接收、反序列化响应契约保留 | 不改 DTO 和两个 selector |
| 超时/取消后的响应 | 上游 callback 的 `send(response)` 仍 unwrap | 保留 detached receiver，禁止 timeout 直接丢弃底层 future |
| 重复请求 | 项目每个 selector 的 busy slot 等最终回调后释放 | 保留有界在途数，不添加循环重试 |
| 原生 Channel 注册表 | 全局 map 持有 Channel clone，没有移除入口 | 保留一次长期订阅，失败不靠创建新 Channel 重试 |
| callback 分发锁 | 新版先从 map 取出 callback / clone Channel，再释放锁后调用 | 获得上游死锁修复；项目 callback 仍只入队 |

本次仅把 ios.rs 中已核查的上游版本注释改为最终采用的 2.12.1，保活机制原样保留。

上游修复的 JavaScript Channel 大包队列与上述原生 Channel 注册表是两个不同 owner。新的 JS 队列归属于具体 WebView，并在该 WebView 关闭时清理；这不等于原生注册表已有删除 API。[Channel 实现](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri/src/ipc/channel.rs)

## 5. 前端、ACL 与 Android 接点

生产前端使用公开 `invoke`、`Channel`、`convertFileSrc`、`listen`、`getCurrentWebviewWindow`、`getVersion` 和 opener 包入口。没有消费私有 Channel 大包队列或手动调用内部 fetch；安全测试中的 `__TAURI_INTERNALS__` 字符串不属于生产桥。官方 [core.ts](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/packages/api/src/core.ts) 保留目前使用的 Channel 构造、onmessage、序列化和 invoke 契约，API 包升级交给 `vue-tsc` 验证实际声明兼容性。

Tauri 2.12 修复了按 capability origin 计算 deny 的范围；项目没有依赖跨 origin 的错误 deny 行为。main WebView 的 app command 限制仍由中央 handler 保留，plugin/core 命令仍由分平台 capability 授权，不因本次升级放宽。[上游变更说明](https://tauri.app/release/tauri/v2.12.0/)

Android 直接 JNI 接点只有插件 `screen.rs` 与 `lifecycle_manager.rs::restart_or_exit_app` 中的 `with_webview().jni_handle().exec`。Android 评估负责人已核对官方 wry 0.57：仍为 jni 0.21 的借用 JNIEnv/JObject closure，本次无需迁移类型。Tauri 与 runtime-wry 自身也仍声明 jni 0.21；Activity 定向派发、Kotlin 模板和 Gradle 验证归 Android 评估记录承接。[Wry JNI 实现](https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/android/mod.rs)

官方列出的 Android `video_dir()` 从 cache 调整到 Movies、本次 `AppHandle::exit` 改为结束 Activity，两项在当前生产源码中均没有直接消费。项目重启流程仍使用自己的 JNI 路径，不顺带改变它的产品行为。[发布记录](https://tauri.app/release/tauri/v2.12.0/)

## 6. 升级与验证交接

最小修改集合为两层 Tauri 主包、两类 build 辅助 crate、两份 lockfile、MSRV 声明，以及撤销 vendor override 和复核 Swift 工程版本断言。插件 opener/log 保留当前版本；HTTP、数据库和前端框架不纳入本次升级。

建议主任务依次取得以下实际证据，结果记录在总验收文档：

1. 更新 lock 后核对只有所需依赖闭包变化，tao 来源回到 registry；不要全图无差别更新。
2. `pnpm check`：实际编译中央 invoke handler、State、DTO 与 TS API 消费者。
3. `pnpm test:run`：验证实际前端状态归约和启动/能力门禁。
4. 插件 `ios::tests`、`events::tests`：验证迟到回调、调用方取消、busy slot 和事件 DTO；host 结果只覆盖纯 Rust 逻辑。
5. 应用 platform / lifecycle 及相关安全边界定向 Rust 测试，确认升级后状态和 IPC 前置条件仍符合现有生产代码。
6. Android arm64 Rust 检查、实际插件 Kotlin/JVM 检查和受影响的 Gradle debug/release 构建；编译成功不替代设备启动/交互证据。

基础评估阶段未运行 Cargo、安装依赖、读取或修改发布流程，也未操作设备或执行 Apple 构建。后续补丁核查只执行下节记录的 `cargo info` 下载；构建与测试由主任务统一执行、记录实际版本。iOS 继续暂停；源码审计与未来 G1 结果分别记录。

## 7. 2.12.1 补丁复核

主任务实际访问 Cargo registry 时发现更新补丁，因此进一步核对正式发布状态。2026-10-08 查询 crates.io API 得到 `max_stable_version = 2.12.1`；3.0.0-alpha.4 是预发布。GitHub `tauri-v2.12.1` 的发布日期为 2026-09-30，`prerelease=false`、`draft=false`。**最终目标采用 2.12.1，前文针对 2.12.0 的源码链接记录基础版本审查，不能据此称 2.12.0 为最新稳定版。**[官方发布](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.12.1)、[registry 元数据](https://crates.io/api/v1/crates/tauri)

官方两个 tag 间有 9 个 commit。读取完整比较中的核心源码 patch，增量涉及 macOS 透明/全屏 API 的 feature 限制、Windows nightly WebView2Loader 查找、docs.rs 跳过原生工程写入、插件示例 ignore 和版本资料；没有新增本项目需要迁移的手机 IPC 契约。[官方差异](https://github.com/tauri-apps/tauri/compare/tauri-v2.12.0...tauri-v2.12.1)

为排除 tag 与发布包差异，在系统临时目录执行 `cargo info tauri@2.12.1 --registry crates-io`，只下载 crate 到 Cargo cache，不运行项目依赖解析，不改项目 manifest/lock。实际 2.12.0 与 2.12.1 发布包的下列五个文件 SHA-256 均一致：

- `mobile/android/build.gradle.kts`
- `src/plugin/mobile.rs`
- `src/ipc/mod.rs`
- `src/ipc/channel.rs`
- `src/state.rs`

因此中央命令总闸、State、原生 receiver 保活与 Channel 所有权结论继续成立。补丁配套版本为：核心/API/CLI 2.12.1，runtime/runtime-wry 2.12.1，build/plugin/macros/codegen 2.7.1，utils 2.10.1。MSRV、tao/wry 依赖线保持。[2.12.1 workspace](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/Cargo.toml)

Android 排障中曾出现 `jackson-datatype-json-org:2.15.3` 下载 404。2.12.1 发布包仍使用该坐标，不能把补丁升级描述为对此依赖的修复；Android 评估随后确认官方 Maven 索引存在该制品，已知存在的 databind 控制请求也返回同类 404，需按当前访问链路问题处理。不能以这次下载失败为由篡改依赖坐标或引入本地 Tauri 副本。
