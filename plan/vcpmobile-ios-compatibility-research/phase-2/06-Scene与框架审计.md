# Phase 2：单 Scene 与框架接入审计

> 以下保留 tao 0.35.3 的历史审计；本地补丁已由官方 tao 0.37.1 替代。Apple 构建与 G1 尚未执行。

> 2026-10-08 再复审：当前 0.37.1 已确认存在单 Scene 同进程断开/重连后的窗口恢复缺口，本文末尾的保留项已进入修复清单；详见 [08 的 R2](./08-代码复审与遗漏清单.md)。

> 2026-10-08。基线：Tauri 2.11.5、runtime-wry 2.11.4、tao 0.35.3、wry 0.55.1。本文记录源码与修改依据，不表示执行过 Apple 编译或设备启动。

## 1. 结论与 D5

继续使用 iPhone/iPad **一个应用 Scene、一个 `main` WebView**。`UIApplicationSupportsMultipleScenes` 保持布尔 `false`；采用 Scene 生命周期不会开放第二个应用窗口。Apple 将 manifest 是否存在与是否允许同时存在多个 Scene 分别定义，不能将二者合并为一个能力。[Apple manifest 定义](https://developer.apple.com/documentation/bundleresources/information-property-list/uiapplicationscenemanifest)、[Apple multiple-scenes 定义](https://developer.apple.com/documentation/uikit/uiapplication/supportsmultiplescenes)。

锁定 tao 有两处独立缺口，本次通过仓库内 `tao 0.35.3` 的最小 iOS 修改闭合：

| 缺口 | 锁定源码行为 | 本次修改 |
|---|---|---|
| Scene 生命周期被 multiple-window 权限控制 | `scene.rs::multiple_scenes_enabled` 读取 `UIApplicationSupportsMultipleScenes`；同时控制 delegate 注册、首窗口绑定和启动完成时机 | 引入 `scene_lifecycle_enabled`，检查 `UIApplicationSceneManifest` 是字典；三处生命周期 gate 使用该函数，真实多窗口权限仍由 UIKit 判断 |
| Objective-C 返回对象所有权错误 | `view.rs::configuration_for_connecting_scene_session` 将 `Retained::as_ptr(&config)` 返回，局部 `Retained` 随后释放 | 改为 `Retained::autorelease_ptr(config)`，交给 autorelease pool 保活至 UIKit 接收 |

第二项是上游已经修复的问题，采用相同的一行所有权修正。[上游 PR #1245](https://github.com/tauri-apps/tao/pull/1245)。

## 2. 首窗口、Scene 与插件 attach

以下函数名以实际锁定源码为准，`tao/…` 对应本仓库 vendor 的 crate 相对路径；Tauri/runtime-wry 为锁文件选中的 crate 源。

1. `Tauri app.rs::Builder::build` 初始化插件；此时配置窗口尚未创建。插件 `register_ios_plugin` 允许 `webview = null`，Swift `PluginManager` 持有实例；插件构造阶段不能假定 `WKWebView.window` 或 Scene 已存在。
2. tao 的 AppDelegate 类在 `view.rs::create_delegate_class` 注册。修正后，字典形式的 Scene manifest 使 `application:configurationForConnectingSceneSession:options:` 被注册，即使 multiple-scenes 为 `false`。
3. `app_state.rs::did_finish_launching` 遇到 Scene 模式时延迟 `on_app_ready`，不会抢先创建无 Scene 的应用窗口。
4. UIKit 请求 configuration；tao 返回名为 `TaoScene`、delegate 为 `TaoSceneDelegate` 的 autoreleased configuration。
5. `TaoSceneDelegate::scene_willConnectToSession_options` 调用 `app_state::connect_scene`。首次连接置 `did_first_scene_connect`，调用 `on_app_ready`，由 `Event::NewEvents(StartCause::Init)` 触发 runtime-wry 的 `RunEvent::Ready`。
6. Tauri `app.rs::setup` 此时遍历 `app.windows`，创建唯一的 `main` 窗口，再调用应用 setup。tao `view.rs::create_window` 在 Scene 模式下先查 `unitialized_scene()`：该函数从 UIKit `connectedScenes` 找到尚未有窗口的 `UIWindowScene` 并执行 `setWindowScene`。
7. 如果已经存在应用 Scene，且 UIKit 不允许多 Scene，现有分支绑定主 Scene；只有 UIKit 明确允许时才请求新的 Scene。当前配置不走该请求分支。
8. Tauri `manager/webview.rs` 在 WebView 创建后调用 `ios::on_webview_created`；Swift `PluginManager` 设置 view controller 并调用尚未加载插件的 `load(webview:)`。VCP 插件在主队列读取 WebView/Scene，并处理重复 attach。
9. 应用在其既有 bootstrap 中订阅原生 Channel。Swift 先装 observer，再发送 UIKit 真实 snapshot；后续变更进入 Phase 1 的 nativeSequence/transitionEpoch 接收链。

`connect_scene` 与 `connectedScenes` 的衔接沿用框架现有 Scene 实现。上述调用链是静态来源证据，不能替代 Apple 链接或运行结果。

## 3. 工程输入

源输入为 [`Info.ios.plist`](../../../src-tauri/Info.ios.plist)，由工程准备脚本验证并进入最终应用 Info.plist：

```text
UIApplicationSceneManifest
  UIApplicationSupportsMultipleScenes = false
  UISceneConfigurations
    UIWindowSceneSessionRoleApplication
      [0]
        UISceneConfigurationName = TaoScene
        UISceneClassName = UIWindowScene
        UISceneDelegateClassName = TaoSceneDelegate
```

`TaoSceneDelegate` 是 tao 的 Objective-C 注册类名，不加 VCP Swift 模块前缀。静态配置与动态返回值指向同一 delegate；不再实现一套替代 Swift SceneDelegate，也不 swizzle AppDelegate。最终 plist 中值的类型也必须正确，字符串 `"false"` 不等于布尔 `false`。

## 4. 修复交付方式与影响

阶段二原实现曾在 `src-tauri/vendor/tao` 保存发布 crate 的源码，并通过应用 `[patch.crates-io]` 引用，同时从 workspace member 集合排除。该历史补丁未引入另一套窗口状态或业务生命周期所有者。

取舍：

- 发布的 0.36.0 虽已包含 autorelease 修复，其 `view.rs` 仍用 multiple-scenes predicate；runtime-wry 2.11.4 的 tao 0.35 约束也不接收 0.36。单独升级版本无法证明 D5 闭合。[上游 0.36.0 view.rs](https://github.com/tauri-apps/tao/blob/tao-v0.36.0/src/platform_impl/ios/view.rs)。
- 不改全局 Cargo registry 缓存；该方式既污染其他项目，也不能由版本库重放。
- 不在构建时临时改源码或更换一份隐藏 lock；当前 override 和差异都可由普通 checkout 审查。
- Cargo 在所有 target 解析同一个 path override；修改只存在于 iOS 后端。没有为了 iOS 改写 Android/host 后端或框架依赖版本。

发布 archive SHA-256 为 `d1c93047acf68669466a34690ac58cca7010bd1b201e1ec86f1fd0a75d3dd4a9`，与修改前应用 Cargo.lock 匹配。复制前逐一比较 archive 的 119 文件，无差异；排除发布 VCS 元数据后保留 118 文件，另增 VCP 来源说明。只有 `ios/{scene,view,app_state}.rs` 这三个源不同，其余 **115 个文件逐字节相同**，包括 Android/host 后端、上游 manifests 与 license。修改文件头记录本地修正，来源、重建步骤和撤销条件见 vendor 说明。

## 5. Lifecycle 事实与剩余边界

tao 0.35.3 的 `sceneWillEnterForeground`、`sceneDidEnterBackground` 为空；`sceneDidBecomeActive` / `sceneWillResignActive` 主要发窗口 Focused 事件。这不满足 VCP 的 active/inactive/background 契约。业务事实由 VCP Swift adapter 的 UIKit notification + Channel 生产，沿唯一 Rust reducer 消费；不将 Tauri `Focused` 或 `document.hidden` 提升为原生生命周期所有者。

需要保留的边界：

- Swift observer、Scene、Channel 和 NWPathMonitor 的替换、清理由插件持有；取消/替换通过 generation 丢弃旧投递。业务 Chat/Sync/DB 状态仍归 Rust。
- 上游 PluginManager 的 `onWebviewCreated` 分支可能重复调用 `load`；VCP 自己检查同一 WebView，不能假定框架每实例仅调用一次。
- 当前 tao 的冷启动 URL/document 处理不在本阶段补丁范围。D1–D19 未授权由此开放 iOS 分享接收、文档类型或 deep-link 产品入口，不因发现框架能力缺口顺带增加这些功能。
- `sceneDidDisconnect` 的窗口恢复行为沿用锁定框架；本次没有实现多窗口/多 Scene 恢复机制。若后续在指定构建诊断中发现直接影响单 Scene 的问题，须回到这一窗口所有者修复。
- 静态检查只覆盖当前 host target；G1 要记录 iOS Rust/Swift 编译、符号和最终 plist。工程检查不能声称实际 Scene attach、前后台回放或用户交互已在设备上验证；项目不建立 iOS 实机测试体系。

## 6. 本轮证据与后续撤销

已执行：archive checksum 对比、全部原始文件比较、三文件差异审计、首窗口/Scene/插件装配的锁定源码追踪。Apple 构建状态与集中检查结果由本阶段验收记录统一登记，本文不预填通过。

待未来依赖升级时，仅在新的 **可被 runtime-wry 接收的发布版本**同时包含 lifecycle gate 与所有权修复后移除 override。移除前重看 delegate 注册、`did_finish_launching`、`create_window` 三入口，保留 plist 的单 Scene 约束，重做当前改动所需的 host/Android 检查和指定 G1/G2 构建。
