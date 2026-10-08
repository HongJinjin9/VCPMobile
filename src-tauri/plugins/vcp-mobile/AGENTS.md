# AGENTS.md — VCP Mobile 移动端原生插件

> 本文件适用于 `src-tauri/plugins/vcp-mobile/**`。它继承仓库根规则，只补充移动端原生能力边界内的代码结构、通信路径与修改闭环；以下代码地图包含 Android 实现与 Phase 2 iOS 接入。

---

## 1. 子系统定位

`tauri-plugin-vcp-mobile` 实现 VCP Mobile 的 Android 原生能力，并接入 iOS Swift 能力查询与生命周期/网络 Channel。它接收 Vue 或 Rust 核心发出的设备意图，经 Rust 插件边界进入对应原生 owner，再把调用结果或原生事件送回实际消费者。iOS 其他 adapter 继续分期实施，需与 host 开发分支显式区分；非 Android fallback 不代表 iOS 可用，也不建立桌面产品能力。

Phase 1 将 Android、iOS、host 的插件分支显式隔离：iOS 尚未接通的首期能力返回 `not_implemented`，当前范围外能力返回 `unsupported`；固定状态与无副作用成功仅保留在排除 Android/iOS 的 host 开发 fixture 中。后续 adapter 只能替换对应 iOS 分支，不能借用 host 成功结果。

### 1.1 正常调用链

```text
Guest JS 包装 ─┐
Vue 直接 invoke ┴─> Rust 注册命令 ─┐
Rust 核心内部调用 ─> Rust 公开入口 ─┼─> PluginHandle / JNI
                                    v
                 VcpMobilePlugin ─> Manager / Service / CLI Host ─> Android
                                    |
                                    └─> Result / trigger / CustomEvent
```

### 1.2 代码结构

| 路径 | 职责 |
| ---- | ---- |
| `src/lib.rs` | 组合插件、注册前端可调用命令、注入 `VcpMobileState` |
| `src/events.rs` | Rust 原生 Channel 订阅、生命周期/网络事件类型、后台服务失败通知与有界待取快照 |
| `src/ios.rs` | 两条内部 Swift 调用的 DTO、协议校验与有界 receiver 保活；调用方超时/取消不丢原生接收端 |
| `ios/Package.swift`、`ios/Sources/VcpMobilePlugin.swift` | Swift product/初始化符号、主队列 app/Scene 观察与 NWPathMonitor；不拥有业务状态 |
| `src/screen.rs` | 经 WebView JNI 进入 `ScreenKeepOnArbiter` |
| `src/stream.rs` | 请求独立的前台保活租约与 helper service 的 Rust 边界 |
| `src/system.rs` | 承接权限、文件、设备状态、更新与系统能力调用 |
| `src/cli.rs` | 承接 Rust 核心到 Android CLI process / PTY 的异步桥接 |
| `android/src/main/.../VcpMobilePlugin.kt` | Kotlin 命令入口与插件 attach/destroy 编排 |
| `android/src/main/.../{service,cli}/` 与各 Manager | 执行独立的原生生命周期、后台服务和平台操作 |
| `guest-js/index.ts` | 提供被显式导出的前端包级调用 |
| `build.rs`、`permissions/`、`AndroidManifest.xml` | 声明命令生成、Tauri 授权和 Android 组件连接 |

---

## 2. 命令与通信约定

### 2.1 前端可调用命令

新增或删除前端 `plugin:vcp-mobile|...` 命令时，以 `src/lib.rs` 的实际注册入口为起点，同步 `build.rs`、相应 permission package 与所需 Kotlin 方法。`guest-js/index.ts` 只为确实使用包级 API 的调用方提供包装，不要求镜像全部注册命令。

Kotlin 中存在 `@Command` 只表示它可被原生插件桥调用，不代表已经向 Vue 公开；不得据此扩张前端 API。

应用授权另由 `src-tauri/capabilities/` 决定。`android-main.json` 逐项授予实际前端消费者需要的插件命令；`ios-main.json` 随已实现的 adapter 增补。`main` 以外当前没有生产窗口消费者，不授予遗留 `vcp-portal-*` 插件权限。Rust 内部调用不经过前端 ACL，仍必须保持自身的平台分支与资源所有者。

### 2.2 Rust 内部入口

Rust 核心可以直接调用 `screen`、`stream`、`system` 或 `cli` 暴露的函数。修改前先从实际调用者追踪到 `PluginHandle.run_mobile_plugin`、异步桥或 JNI 终点；内部能力不得为了形式一致而注册成前端命令。

### 2.3 原生事件与生命周期

`PluginHandle`、JNI、`plugin.trigger` 与 `evaluateJavascript` 是不同通道。事件变化必须同时追踪生产者和真实接收者；插件生命周期变化必须覆盖 `init`、`load`、`onDestroy` 以及对应 Manager、Service 或 Host 的建立与释放。

---

## 3. 修改与完成边界

跨层字段、方法名、返回值或事件必须沿生产调用链一次改完，并保留一个活动入口和一个实际所有者。长生命周期锁、Service、进程或 PTY 状态归当前持有它的原生组件管理，调用层只提交意图并消费结果，不复制第二套状态。

Rust 边界变化在 `src-tauri/` 运行 `cargo check --locked -p tauri-plugin-vcp-mobile`；涉及前端类型或跨层调用时从仓库根运行 `pnpm check`。Kotlin、Manifest 或 Service 变化还需编译实际 Android 插件目标。测试只能作为额外执行结果，不能定义生产代码应有行为。

Swift 接入时同步核对 `ios_path`、SwiftPM product、初始化 binding、selector、DTO、Channel 与资源归属；UI 操作显式在主队列执行，领域状态仍归 Rust。Apple 编译/链接按根规范集中在手动 Actions G1/G2，日常源码审计记录具体目标分支与待办。

当前 iOS 只在 Rust bootstrap 安装一次长期 Channel；Swift WebView 替换复用同一 Channel 并更换观察者 generation。锁定 Tauri 的原生 Channel 注册表没有删除入口，不能通过反复创建 Channel 实现重试。两条短原生请求分别最多一个在途；超时后底层任务仍接收最终回调，能力查询可在其完成后重试，真正订阅失败需重新启动 App。

**完成**：实际消费者、Rust 边界、Kotlin 所有者、平台声明及返回通道保持一致，并分别说明已取得的 host、Android 构建或设备证据。
