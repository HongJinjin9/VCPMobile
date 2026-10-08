# Phase 2：Rust 事件桥接与历史能力契约撤销

> 2026-10-09 按当前桥接代码校准。文件名保留历史导航；全局能力契约与 Swift 能力查询已经撤销，事件注册和接收端生存期继续由本文件说明。Apple 编译/链接结果单独在 G1 登记。

## 1. 原生装配

| 环节 | 生产入口与约束 |
|---|---|
| 构建 | 插件 `build.rs` 同时声明 `.android_path("android")` 与 `.ios_path("ios")`；目标选择由锁定 Tauri build 实现负责 |
| Swift 静态 product | `tauri-plugin-vcp-mobile`，保持 Cargo package/linker 名称；不改为带下划线的 product |
| 初始化符号 | Swift 导出和 Rust `tauri::ios_plugin_binding!` 同为 `init_plugin_vcp_mobile` |
| 注册 | 插件 `lib.rs::init` 的 iOS 分支调用 `register_ios_plugin`，实际 handle 存入原 `VcpMobileState` |
| 事件 | `events::subscribe` 在 Android/iOS 均可编译；iOS 经 `ios::register_native_events`，Android 保留原调用 |
| 公开命令 | 原有 42 条插件前端命令保持；Swift 事件注册为 Rust 内部消费，不增加前端 ACL |

Swift 只拥有原生 observer、Channel 和 NWPathMonitor，应用的 lifecycle 排序和业务 transition 仍归 Rust 现有 owner。

## 2. 当前订阅消费者与已撤销查询

历史 `getNativeCapabilities`、`NativeCapabilities`/`NativeRuntime`、app `get_platform_capabilities` 及前端平台 Store/parser 已删除。平台身份由官方 OS 插件同步提供；系统权限和操作结果仍由实际消费者读取。不存在“先查询 24 项能力，才能启动”或“把实现态写成可用”的活动任务。

`registerNativeEvents` 接受 Tauri Channel，返回 `{ "protocolVersion": 1 }`。注册时回放 lifecycle 事实，保持既有字段 `phase`、`nativeSequence`、`snapshot`。网络事件仍为 `{ "event": "network", "payload": { "connected": true } }`；只有取得真实 NWPath 结果才发送，没有固定在线/离线初值。

Rust bootstrap 只建立一次长期订阅，前端重试只重做自己的启动流程，不重装 Channel。真实注册失败由现有 service failure owner 在进程内保留，并通过 live event 和系统快照告知；同一 WebView 接受一次，新 WebView 可再次得到失败，见 12。业务窗口重建不重新 bootstrap Rust，也不建立第二个原生 Channel。

## 3. 独立等待、取消与有界资源

锁定 `tauri@2.12.1/src/plugin/mobile.rs::run_mobile_plugin_async` 的 callback 使用 `send(response).unwrap()`。直接取消这个 future 会丢掉 receiver，使迟到原生响应触发 panic。

`ios.rs::receive_native` 为唯一事件注册保留一个在途槽位。取得槽位后立即启动独立任务，任务持有完整 native future 直到实际 resolve/reject；任务 RAII guard 释放槽位。注册 owner 持续等待该结果；即使外层等待取消，底层 receiver 仍保留。历史能力查询的 5 秒期限和专属槽位已随查询删除，不能再把该期限加回长期订阅。

- 旧注册回调未完成时，重复调用返回 `native_busy`，不会追加任务；实际 bootstrap 只发起一次注册，最多保留一个 receiver。
- 晚到注册结果由原订阅任务消费，不用首个 lifecycle/network 事件替代 ack；Channel 的有效性由 Swift generation 和原 Rust transition owner 决定。
- Swift selector 在主队列做有限的内存/observer 装配，每条路径恰好一次 resolve/reject；不等待网络首包、不执行文件复制或业务 IO。
- 若系统主队列永久失去响应，最多保留一项在途注册到进程结束，不能安全强制丢弃 Tauri receiver，也不把没有完成报成真实 reject。该独立等待不阻塞已经 READY 的核心启动。

本桥不建立任意命令代理、业务 generation 状态或第二套业务终态。Android 原生调用和其现有取消语义不在本补丁中改写。

锁定 Tauri 的 `Channel::new` 会立即将 Channel 放进 mobile 全局表，当前没有公开的删除入口。实际 Rust bootstrap 只创建一个长期原生 Channel；Swift `load` 更换 WebView 时复用该 Channel、先清旧 observer/monitor 再读取真实 snapshot，迟到 NWPath 回调按 generation 丢弃，因此该使用路径有界。将来若增加注册重试，必须复用已有 Channel，不能每次 `Channel::new` 后仅 drop Rust 局部变量就声称已释放全局注册。

## 4. 验证与交接

当前回归针对取消后 sender 仍可成功、旧回调未返回时重复调用受在途上限约束、最终成功/失败能由独立等待消费，以及真实注册失败跨 WebView 重放。原能力 DTO/映射/查询期限测试已撤销。测试执行共享接收任务，不是 Swift/UIKit 运行证据；历史检查与本次结果分别见 07、12–13 和 README。

host 检查只能覆盖共享 DTO、取消保留算法、app 公共代码与 host cfg。`register_ios_plugin`、Apple ABI、Swift selector 和静态链接仍需 G1 Apple 编译；后续阶段新增原生长任务时，应在其真实 owner 上定义任务标识和终态，不能直接套用本阶段短控制调用来声称已解决业务取消。
