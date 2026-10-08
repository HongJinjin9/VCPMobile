# Phase 2：Swift 原生事件与资源

> 2026-10-09 按当前 Swift 源码校准。初次 2026-10-08 接入时的能力查询已删除，现仅保留原生事件注册；Apple 编译、链接和实际运行尚无 G1 结果，不以 Windows 检查代替。

## 1. 包与入口

- [Package.swift](../../../src-tauri/plugins/vcp-mobile/ios/Package.swift) 使用 Swift tools 5.5、最低 iOS 15.0、静态 product `tauri-plugin-vcp-mobile`。这个连字符名称由 Rust 插件 package/linker 消费。
- Tauri 包来自构建器复制的 `../.tauri/tauri-api`。SwiftRs 直接约束 `.exact("1.0.7")`，仅约束本插件依赖；G1 不再预置集中 lock 或拦截 SwiftPM，各 package 使用自身 manifest/lock 解析，见 10。
- [VcpMobilePlugin.swift](../../../src-tauri/plugins/vcp-mobile/ios/Sources/VcpMobilePlugin.swift) 导出 `@_cdecl("init_plugin_vcp_mobile")`，返回 Tauri `Plugin`。符号中的下划线与 product 的连字符各自保持，不混用。
- 仅保留 Rust 内部消费的 `registerNativeEvents:` selector；不新增前端 plugin command、权限或无消费者的注销接口。平台身份由 OS 插件同步注入，不通过 Swift 事件插件查询。

当前接口来源为 `tauri@2.12.1/mobile/ios-api/{Package.swift,Sources/Tauri/{Tauri.swift,Invoke.swift,Channel.swift,Plugin/Plugin.swift}}`；最初对照 2.11.5 的记录属于历史，升级后的接口比较见 Git 中 `76ade999` 的升级审计。未修改 registry 或生成的 `.tauri` 副本。

## 2. 原生握手与事件契约

历史 `getNativeCapabilities` 曾报告 lifecycle/network source readiness，现已随无消费方的四轴能力模型移除，包括相应 DTO 和 `sourceFailed` 状态。实际相位、网络观察和注册完成结果继续分别沿原事件/响应通道发送，不再生成能力快照。

`registerNativeEvents` 解析 Tauri `Channel`，在主队列替换订阅、安装观察者、回放生命周期快照并启动 NWPathMonitor，随后恰好一次返回 `{"protocolVersion":1}`。参数或序列化失败恰好一次 reject。方法不等待首次网络回调，也不等待业务恢复；Rust 独立订阅任务持续消费真实注册结果，没有 5 秒注册等待期限。

生命周期事件沿用 Phase 1 DTO：

```json
{
  "event": "lifecycle",
  "payload": { "phase": "inactive", "nativeSequence": 1, "snapshot": false }
}
```

- `phase` 只有 `active`、`inactive`、`background`。
- 进程静态 `observedPhase/nativeSequence` 在主队列串行更新；真实相位变化递增，第一次快照允许 0。普通同相位通知去重。
- 重注册快照同相位时复用原 sequence；Rust 已接受过该值就丢弃，避免重注册制造新的 transition epoch。重新观察到相位变化则递增。
- `snapshot` 只描述本次消息是否回放，不代替 Rust `transitionEpoch`，不复制 Chat/Sync 领域状态。

网络事件保持既有 `{"event":"network","payload":{"connected":true}}`。仅在首次 NWPath 回调与后续 connected 变化时发送；首次回调前不读取 `currentPath`，不发送默认 false。`connected` 表示系统路径 `status == .satisfied`，仍需实际 Rust transport 判断服务是否可达。NWPathMonitor 的 start、回调队列和 cancel 是 [Apple 原生 API](https://developer.apple.com/documentation/network/nwpathmonitor/)。

## 3. Scene、线程与 Balthasar 审查

插件读取 WebView 的 `windowScene`；尚未 attach 时可读取唯一 application Scene。没有已连接 Scene 时才使用 UIApplication 状态/通知。应用单 Scene 装配归工程入口，插件不替换 application/scene delegate，不开启多窗口。

相位变化订阅 UIKit 的 Scene 通知；无 Scene 时使用对应 UIApplication 通知。`willDeactivate`/`willResignActive` 明确产生 `inactive`，不能在“即将失活”通知中读仍可能是 active 的属性再误发 active。系统提醒、控制中心等临时中断保持 inactive，不提前宣称已经后台。[Apple willDeactivate 语义](https://developer.apple.com/documentation/uikit/uiscene/willdeactivatenotification)

Tauri 2.12.1 的 selector 在独立 IPC 队列执行。事件注册和 WebView attach 明确切到主队列，所有 UIKit 查询、observer/Channel 归属、sequence 与 generation 都在该队列串行处理。NWPathMonitor 在专用队列接收路径，提取一个 Bool 后切到主队列过滤 generation 并发事件。没有在 UIKit 队列加入文件 IO、解码大附件或等待 Rust 任务；Rust Channel 回调只应入队。

Balthasar 裁决：原生中断和真正后台必须分开；未知网络不能显示为断网；重注册不制造前台恢复；保持现有界面，不引入新的状态提示、动画或第二套领域状态。界面 Insets、屏幕常亮、Files/照片等仍由后续阶段接入。

## 4. 资源与迟到回调

| 情况 | 已实现处理 |
|---|---|
| Channel 重新注册 | 更新 UUID generation，移除旧 observer，cancel 旧 monitor，释放旧 Channel，清除本订阅缓存，再建立新资源 |
| 同一插件 attach 新 WebView | 保留当前 Channel 意图，重建事件资源并重新读取 UIKit 快照 |
| 旧网络/通知回调已排队 | weak self + 注册时 generation 检查；旧 generation 不得向新 Channel 写入 |
| 应用正常终止通知 | 清除订阅资源；不将该通知视为一定会发生的系统强杀回调 |
| 插件释放 | deinit 移除 observer、cancel monitor；回调仅弱持有插件，不形成循环引用 |
| 编码失败 | 停止当前源、记录错误；注册期间返回 reject。当前简单载荷未找到正常输入下的编码失败复现，不新增无人消费的健康状态 |

没有额外注销 selector，因为当前 Rust 生命周期拥有进程级订阅，没有需要公开停止的真实消费者；后续若出现可取消订阅任务，再沿真实 owner 增加协议。

## 5. 验证与后续边界

- 已完成锁定 Tauri 的 selector、Encodable resolve/send、Channel 解码、初始化 ABI 与资源归属源码核对。
- Swift 源码无文件/电量/磁盘/保活/后台任务接口，也不写 NSUserDefaults。Privacy 清单依实际应用其他消费者审计，不因本插件添加占位申报。
- 未执行 Swift 编译、Apple 链接、模拟器或设备操作。G1 通过实际工具链编译 Swift package，并保存 product/初始化符号、部署目标及 Scene 工程输入供审查；不恢复静态集合门禁。
- 编译通过仍不等于已取得 UIKit 生命周期或网络行为的运行证据；当前任务不建立项目 iOS 实机测试体系。
