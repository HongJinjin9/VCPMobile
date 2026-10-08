# Phase 2：Rust 桥接与能力契约

> **后续状态：iOS 实施与 G1 已暂停。** 本文保留原阶段二桥接记录；Tauri 2.12 仍需相同的原生 receiver 保活与 Channel 上限，见 [升级审计](../../tauri-2.12-upgrade/03-iOS既有输入与补丁撤销.md)。

> 2026-10-08。本文记录本阶段生产接入与验证边界；Apple 编译/链接结果单独在 G1 登记。

## 1. 原生装配

| 环节 | 生产入口与约束 |
|---|---|
| 构建 | 插件 `build.rs` 同时声明 `.android_path("android")` 与 `.ios_path("ios")`；目标选择由锁定 Tauri build 实现负责 |
| Swift 静态 product | `tauri-plugin-vcp-mobile`，保持 Cargo package/linker 名称；不改为带下划线的 product |
| 初始化符号 | Swift 导出和 Rust `tauri::ios_plugin_binding!` 同为 `init_plugin_vcp_mobile` |
| 注册 | 插件 `lib.rs::init` 的 iOS 分支调用 `register_ios_plugin`，实际 handle 存入原 `VcpMobileState` |
| 事件 | `events::subscribe` 在 Android/iOS 均可编译；iOS 经 `ios::register_native_events`，Android 保留原调用 |
| 公开命令 | 原有 42 条插件前端命令保持；两个 Swift selector 都是 Rust 内部消费者，不增加前端 ACL |

Swift 只拥有原生 observer、Channel 和 NWPathMonitor，应用的 lifecycle 排序和业务 transition 仍归 Rust 现有 owner。

## 2. 两个当前消费者与 DTO

`getNativeCapabilities` 接受空对象，返回：

```json
{
  "protocolVersion": 1,
  "platform": "ios",
  "lifecycle": { "implemented": true, "runtime": "unknown" },
  "networkEvents": { "implemented": true, "runtime": "unknown" }
}
```

`runtime` 只允许 `available`、`unknown`、`unavailable`。Rust 要求所有字段及正确类型、固定 iOS 平台与协议版本；未实现 adapter 不能同时报告 available。Swift 从主队列读取真实订阅状态，查询不创建第二个观察源。注册前 lifecycle 为 unknown；observer/Channel 就绪才是 available。网络首次 NWPath 回调前为 unknown，已有观察后的 disconnected 仍表示观察源可用，不能混同未知状态。

`registerNativeEvents` 接受 Tauri Channel，返回 `{ "protocolVersion": 1 }`。注册时回放 lifecycle 事实，保持既有字段 `phase`、`nativeSequence`、`snapshot`。网络事件仍为 `{ "event": "network", "payload": { "connected": true } }`；只有取得真实 NWPath 结果才发送，没有固定在线/离线初值。

app `get_platform_capabilities` 改为 async 并注入 AppHandle。iOS 调用原生查询并将 lifecycle 的实现/运行观察合并进原有 24 项能力契约；调用失败向前端原 store 返回错误，使用既有启动重试。Android/host 保留原能力结果。只有 Lifecycle 开启实现状态；`networkEvents` 是内部连通性事件源，不启用完整 `NetworkStatus` 设备遥测，也不启用后台保活、Files、Insets 等后续 adapter。

原生 source readiness 是能力查询时的快照，不是第二份业务状态树。现有前端 `isImplemented` 仍只判断产品支持与实现，不将 unknown 转为授权成功。

能力查询重试与事件源恢复是两条不同路径：前端启动重试会重新查询能力；当前 Rust bootstrap 只建立一次原生事件订阅。真实注册 reject 或 Swift `failSubscription` 清空 Channel 后，本进程没有自动重装订阅的入口，需要重新启动应用。注册调用者超时但原生稍后完成时，原 Channel 仍可正常送达事件，不能将该情形误判为已取消原生注册。

## 3. 取消、超时与有界资源

锁定 `tauri@2.11.5/src/plugin/mobile.rs::run_mobile_plugin_async` 的 callback 使用 `send(response).unwrap()`。直接取消这个 future 会丢掉 receiver，使迟到原生响应触发 panic。

`ios.rs::receive_native` 为两个具体 selector 各保留一个在途槽位。取得槽位后立即启动独立任务，任务持有完整 native future 直到实际 resolve/reject；任务 RAII guard 释放槽位。调用者最多等待 5 秒，超时只丢弃 JoinHandle，任务继续收取最后响应；调用者主动取消也只丢弃等待。该 JoinHandle 不向外暴露，不调用 abort。

- 一个 selector 的旧回调未完成时，重试返回 `native_busy`，不会追加任务；两个 selector 合计最多保留两个 receiver。
- 迟到返回值只结束自己的任务，不回写前端能力或业务生命周期；事件 Channel 的有效性由 Swift 订阅 generation 和原 Rust transition owner 决定。
- Swift selector 在主队列做有限的内存/observer 装配，每条路径恰好一次 resolve/reject；不等待网络首包、不执行文件复制或业务 IO。
- 若系统主队列永久失去响应，不能安全强制丢弃 Tauri receiver。此时最多保留上述两个任务到进程结束，调用者仍有超时错误。这是固定上限的故障行为，不能宣称主队列故障时可强制回收原生调用。

本桥不建立任意命令代理、业务 generation 状态或第二套业务终态。Android 原生调用和其现有取消语义不在本补丁中改写。

锁定 Tauri 的 `Channel::new` 会立即将 Channel 放进 mobile 全局表，当前没有公开的删除入口。实际 Rust bootstrap 只创建一个长期原生 Channel；Swift `load` 更换 WebView 时复用该 Channel、先清旧 observer/monitor 再读取真实 snapshot，迟到 NWPath 回调按 generation 丢弃，因此该使用路径有界。将来若增加注册重试，必须复用已有 Channel，不能每次 `Channel::new` 后仅 drop Rust 局部变量就声称已释放全局注册。

## 4. 验证与交接

定向检查包含 DTO 错误版本/平台拒绝、调用者超时后迟到 sender 仍可成功、旧回调未返回时新调用被拒绝、调用者取消后最终 receiver 存活，以及 app 能力映射不误启用其他 adapter。测试模拟 Tauri 的完成通道，不是 Swift/UIKit 运行证据；实际执行结果统一写入阶段验收记录。

host 检查只能覆盖共享 DTO、取消保留算法、app 公共代码与 host cfg。`register_ios_plugin`、Apple ABI、Swift selector 和静态链接仍需 G1 Apple 编译；后续阶段新增原生长任务时，应在其真实 owner 上定义任务标识和终态，不能直接套用本阶段短控制调用来声称已解决业务取消。
