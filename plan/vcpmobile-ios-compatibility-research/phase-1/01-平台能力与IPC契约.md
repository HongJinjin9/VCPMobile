# Phase 1：平台能力与 IPC 契约

> 2026-10-08。来源：本阶段 `infra/platform.rs`、`commands.rs` 与实际前端 owner；不表示后续 Swift 功能已完成。

## 1. 唯一来源与启动关系

`src-tauri/src/vcp_modules/infra/platform.rs::get_platform_capabilities` 从编译目标提供当前平台和实现状态，不查询权限、不申请资源、不等待数据库。通过现有 `commands.rs` 中央 offload 注册；没有新增第二个命令分发器或后台 owner。

`src/core/stores/platform.ts` 持有一份进程前端快照；现有 `appLifecycle.bootstrap` 先 `load()`，之后才执行相应权限检查、预加载和 READY。能力请求同 flight 复用；失败保持 `snapshot=null`、记录真实错误、允许重试。刷新失败不保留旧成功快照。前端按 `core/types/platform.ts` 校验每个必需字段，缺失或类型错误不能通过默认值获得能力。

## 2. 四轴语义

| 字段 | 值 | 本阶段语义 |
|---|---|---|
| `platform` | `android / ios / host` | Rust 编译目标；host 仅开发，不以 UA 猜测 |
| `support` | `supported / unsupported` | 当前产品范围是否支持该目标能力，不是系统永久能力判断 |
| `implementation` | `implemented / notImplemented` | 当前源码是否已有该目标实现 |
| `authorization` | `notRequired / unknown / granted / denied` | 只有实际授权观察才能产生 granted/denied；Android 需权限的能力当前为 unknown，原权限 owner 继续实际查询 |
| `runtime` | `available / unknown / unavailable` | 有实现不等于当前原生资源已就绪；本阶段 Android 为 unknown，缺实现的平台为 unavailable |

`isImplemented(name)` 与 `require(name)` 只检查支持与实现。它们用于选择入口，不替代权限申请、资源获取或命令的真实 Result。不得将 implementation 当作用户已授权，也不得把 capability 快照当作持续原生状态监听器。Phase 2 的实际 adapter 可补运行状态来源，保持唯一事实 owner。

## 3. 当前 24 项能力

Android 均有现有实现；具体授权和执行结果继续由原 owner 决定。host 不声明这些原生产品能力，底层既有 fixture 保留在明确的 host cfg 分支供开发使用。

| iOS 当前分类 | 能力字段 |
|---|---|
| 产品支持，adapter 未实现 | `nativeInsets`、`filePicker`、`photoPicker`、`fileExport`、`fileOpen`、`batteryStatus`、`diskSpace`、`keepScreenOn`、`backgroundExecution`、`lifecycle`、`webviewCache` |
| 当前产品不支持或延期 | `androidPermissionGate`、`apkUpdate`、`incomingShare`、`systemNotifications`、`moveTaskToBack`、`rootAccess`、`cli`、`distributed`、`voiceRecording`、`camera`、`gallerySave`、`outgoingShare`、`networkStatus` |

`networkStatus` 对应当前完整设备遥测 getter，不代表 Phase 2 的连接变化 Channel 被延期。`fileExport` 的目标是 Files 导出，不承诺继承 Android Downloads/Base64 协议。HTML 文件/图片导入与本地查看是共享子路径，不冒充 native picker/外部打开实现。

## 4. 后端与窗口边界

| 入口 | 实际门禁位置 |
|---|---|
| 应用自定义 IPC | `commands.rs` 仅接受 `main` WebView，然后进入既有 worker offload；非 main 立即拒绝，只有一个响应 |
| APK 状态/检查/下载/取消/安装 | `update_manager.rs` 五个 command 先检查 `ApkUpdate`，网络和文件操作在其后；旧 OTA 清理仅编译/启动于 Android，辅助清理测试保留 host 构建 |
| CLI 状态、执行、导入、终端 | `cli/runtime.rs` 六个与 `cli/terminal.rs` 五个 command 在副作用前检查 `Cli`；纯 manifest 序列化仍是可读取的协议元数据，不表示运行时可用 |
| Distributed 七个 command | `distributed/mod.rs` 在查询/持久化/执行/重连前检查 `Distributed`；启动和配置调和由原 lifecycle owner 同时守卫 |
| Sync 日志分享准备 | `prepare_sync_log_share_file` 创建临时副本前检查 `OutgoingShare` |
| 外部文件打开/WebView 清理 | iOS app command 返回 `not_implemented`；共享本地查看与 SQLite 维护保持 |
| 原生 plugin command/Rust 内部调用 | 见 02，iOS 与 host fixture 分离；前端 ACL 不替代内部 Rust 分支 |

不使用额外的 app ACL manifest 改写全部 app command 权限集合。锁定 Tauri 对本地 app command 的默认处理不受插件 ACL 直接约束，因此 `main` 总闸是必要的补充；portal 无当前生产创建者/消费者，不授命令权限。Android `core:window:allow-close` 保留原双击返回在 native 失败时的 fallback。

## 5. 编译与包体积边界

新增 Swift 工程不会进入 Android APK；本阶段 iOS 原生分支不会执行 host 模拟结果。共享 Rust/前端逻辑仍分别进入目标构建，运行时能力门禁本身不保证 JS 或 Rust 模块被裁剪。本阶段没有安装包体积测量，也没有宣称删除所有延期功能的机器码；较大的目标专属依赖/资源在真实接入时按构建图隔离。

## 6. 验证与后续输入

平台 store 行为测试覆盖：缺字段/非法枚举、同 flight 合并、未知时禁止入口、失败可重试、刷新失败清除快照、支持但未实现与不支持的区别。Rust 测试覆盖各目标实现/授权/运行状态的区别；统一结果见 07。

Phase 2 需要同时连接 native handle、Channel producer、订阅和 lifecycle bootstrap，再更新对应能力。Phase 3 处理 Sync 的移动端 loopback 策略与 iOS 业务收尾；Phase 4 完成 Files/PHPicker/ImageIO、Files 导出与 WebKit adapter；Phase 5 实现后台任务而非提前把 capability 改成成功。
