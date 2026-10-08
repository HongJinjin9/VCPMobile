# Phase 1 · 插件平台隔离与 ACL

> 2026-10-08，基于 Phase 0 提交 `489b3341` 后的生产源码实施。本文只记录插件边界与窗口授权；阶段总验收另行汇总。未执行 Apple 构建，不表示 Swift adapter 已存在。

## 1. 实际入口与修改范围

入口是 `src-tauri/plugins/vcp-mobile/src/lib.rs::init` 的 42 条公开命令；业务 Rust 还直接调用 `system`、`stream` 和 `cli`，因此仅修改 capability JSON 不足以隔离平台。

| 文件 | 修改与所有者 | 输入、错误及资源边界 |
|---|---|---|
| `src/lib.rs` | Android `PluginHandle` 保留；iOS 待接 adapter 状态与 host marker 分开；统一生成 iOS 错误 | 维持现有 `Result<T, String>`；`not_implemented:` 表示待实现，`unsupported:` 表示当前 iOS 范围不支持；不添加 Swift 注册 |
| `src/system.rs` | 43 处原 `not(android)` 分支拆为 iOS 与明确排除两种移动平台的 host 分支 | iOS 不返回 host 权限全真、固定磁盘、电量、网络、传感器、GPU 或剪贴板数据；无副作用成功也不能代替真实操作 |
| `src/screen.rs` | iOS 屏幕常亮操作返回待实现 | Android JNI arbiter 不变；iOS 不声称取得或释放 screen owner |
| `src/stream.rs` | iOS operation lease 返回待实现；helper/Distributed 保活返回不支持 | `ForegroundLease::acquire` 失败时不产生成功 lease，原有非 Clone、唯一 tag、Drop 释放关系保留 |
| `src/cli.rs` | process 四条和 PTY 五条内部桥明确拒绝 iOS | Rust 内部调用不绕过平台边界；没有为延期 CLI 创建原生空壳 |
| `src-tauri/capabilities/*.json` | 按平台与真实窗口消费者缩小前端授权 | 42 条注册和权限全集保留；仅 Android `main` 获得当前实际使用的 22 条 native grants |

`events.rs`、Android 生命周期 producer 与其测试由本阶段生命周期子项统一修改，不由本子项重复改变。原有六个 permission 文件的工作树内容完整保留。

## 2. 42 条公开命令的当前 iOS 结果

`待实现` 对应 `not_implemented`；`不支持` 对应 `unsupported`，表示当前产品范围，而非判断系统永远无法提供这类能力。表中“Android grant”是前端窗口授权，不代表内部 Rust 能力存在与否。

| 公开命令 | iOS 当前结果 | Android grant / 真实消费者 |
|---|---|---|
| `set_keep_screen_on` | 待实现 | 无前端消费者，不授予 |
| `clear_keep_screen_on` | 待实现 | 无前端消费者，不授予 |
| `acquire_foreground` | 待实现 | Rust 内部 owner，不授予 |
| `release_foreground` | 待实现 | Rust 内部 owner，不授予 |
| `start_helper_service` | 不支持 | Rust helper owner，不授予 |
| `check_all_permissions` | 不支持 Android 权限集合 | PermissionGate、启动、CLI、Distributed |
| `request_android_permission` | 不支持 | PermissionGate、录音、更新、CLI、Distributed、备份 |
| `move_task_to_back` | 不支持 | App 返回、PermissionGate |
| `check_notification_listener_permission` | 不支持 | PermissionGate、启动 |
| `request_notification_listener_permission` | 不支持 | PermissionGate |
| `request_auto_start_permission` | 不支持 | 无前端消费者，不授予 |
| `request_power_management_permission` | 不支持 | PermissionGate |
| `check_auto_start_permission` | 不支持 | 无前端消费者，不授予 |
| `get_free_disk_space` | 待实现 | PermissionGate |
| `pick_file` | 待实现 | 附件、Agent/Group/UserProfile、CLI |
| `get_battery_status` | 待实现 | 手动 Sync 的发起前条件检查 |
| `get_network_status` | 不支持完整遥测 | Rust telemetry owner，不授予 |
| `open_file_native` | `view` 待实现；`share` 不支持 | CLI manifest、Sync 日志分享 |
| `capture_window_snapshot` | 不支持 | 无前端消费者，不授予 |
| `save_image_to_gallery` | 不支持延期 PhotoKit 保存 | 图片/附件/Mermaid 查看器 |
| `save_image_from_path` | 不支持延期 PhotoKit 保存 | 无前端消费者，不授予 |
| `save_to_downloads` | 待实现 Files exporter；不沿用 Android 公共 Downloads 静默写入 | `useConfigBackup.ts`；`src/features/mail/mailStore.ts::downloadAttachment` 经 guest `saveToDownloads` |
| `write_temp_file` | 待实现容器 staging | CLI manifest |
| `delete_temp_file` | 待实现容器 staging | Agent/Group/UserProfile 选择清理 |
| `start_download_notification` | 不支持 APK 更新 | useUpdateDownloader |
| `update_download_notification` | 不支持 APK 更新 | useUpdateDownloader |
| `cancel_download_notification` | 不支持 APK 更新 | useUpdateDownloader |
| `get_pending_notification` | 不支持延期系统通知 | App 启动通知入口 |
| `register_shared_files` | 不支持延期 incoming share | App 分享入口 |
| `get_cpu_thermal_status` | 不支持完整遥测 | Rust telemetry owner，不授予 |
| `get_gpu_status` | 不支持完整遥测 | Rust telemetry owner，不授予 |
| `check_root_access` | 不支持 | DistributedView |
| `run_root_command` | 不支持 | Rust 内部调用，不授予 |
| `launch_root_manager` | 不支持 | DistributedView |
| `acquire_wake_lock` | 不支持 Android WakeLock | 无前端消费者，不授予 |
| `release_wake_lock` | 不支持 Android WakeLock | 无前端消费者，不授予 |
| `start_network_monitoring` | 不支持此 Android 命令 | 原生事件 owner 自动监测，无前端消费者 |
| `verify_apk_signature` | 不支持 | Rust updater owner，不授予 |
| `can_install_packages` | 不支持 | Rust updater owner，不授予 |
| `open_unknown_sources_settings` | 不支持 | UpdatePrompt |
| `acquire_ota_keepalive` | 不支持 | Rust updater owner，不授予 |
| `release_ota_keepalive` | 不支持 | Rust updater owner，不授予 |

11 条命令涉及待实现能力（其中 `open_file_native` 按意图再分支），其余 31 条属于当前 iOS 不支持的命令面。类型化的平台能力由 app 层提供，不要求 UI 调用失败命令来探测平台；表中 22 条 Android native grants 都保留真实前端调用链。

`fileExport` 保留既定 Files exporter 实施目标，当前 `save_to_downloads` 返回 `not_implemented`；Phase 4 需将大 Base64 改为有预算的 URL/ticket 交接，不因保留目标而承诺沿用当前传输契约。`networkStatus` 对应现有完整遥测 getter，在 iOS 为不支持；Phase 2 生命周期网络 Channel 独立表达网络变化，不与该遥测开关混同。

公开命令以外，`set_keepalive_mode` 是 app 注册的 Android 保活命令，内部入口也明确拒绝 iOS；`request_overlay_permission` / `toggle_floating_ball` 仍未注册，不通过本次整改恢复归档助手。传感器、原生剪贴板、通知内部函数及 CLI 桥同样具有 iOS 错误分支。生命周期网络通知与完整 telemetry status 不是同一个契约，后续 Channel 接入不受本表中遥测延期的影响。

## 3. 窗口与平台授权

| Capability | 生效目标 | 窗口 | 权限 |
|---|---|---|---|
| `default.json` | Android、Windows/macOS/Linux 开发 host | `main` | `core:default`、`opener:default` |
| `android-main.json` | Android | `main` | 上表 22 条逐项 `vcp-mobile:allow-*`，加 `core:window:allow-close` |
| `ios-main.json` | iOS | `main` | `core:default`、`opener:default`，当前无本插件 native grants |
| `host-main.json` | Windows/macOS/Linux 开发 host | `main` | host scaffold 的 `core:window:allow-close` |

源码搜索 `src/` 与 `src-tauri/src/` 后，未发现 `vcp-portal-*` 窗口创建者、portal 原生调用或创建 WebviewWindow 的生产入口；目前只有 Tauri 配置的 `main`。因此删除 portal 通配授权，以及没有消费者的 hide/create-window/create-webview-window grants。不建立空 portal 产品入口或为它预留全部权限。

Android `close` 有实际消费者：`App.vue` 根部双击返回在 `move_task_to_back` 失败后调用 `getCurrentWebviewWindow().close()`。这条既有异常路径继续获得 core 授权；它不计入 22 条 native grants，也不向 iOS 授权程序化关闭。

原 `default.json.protocols` 不是锁定版本 `tauri-utils 2.9.3` 的 `Capability` 字段。本次移除这一被忽略的遗留对象；实际 URI scheme 注册、资源访问路径与 `tauri.conf.json` 的 asset scope 没有据此改变。平台拼写采用该版本 `Target` 的 serde 值：`android`、`iOS`、`macOS`、`windows`、`linux`。

### App 命令与插件 ACL 是两道边界

核对 `tauri 2.11.5/src/webview/mod.rs::on_message` 后确认：无 app ACL manifest 时，本地自定义 app commands 不因没有匹配的 capability 自动拒绝；插件命令和远端请求仍执行 ACL 校验。当前 app build 没有声明 app command manifest。

因此“portal 没有 plugin grants”不能单独推出“portal 不能执行所有 app commands”。本阶段 app 集成在 `commands.rs` 中央分发处另行收口到 `main`，保留所有共享命令和一次 worker offload。该门禁的最终实现与验证由阶段总验收记录；本文不会用 capability JSON 代替它。

## 4. Host 与编译语义审查

- 固定磁盘/电量、模拟传感器、权限全真等旧结果仅保留在 `not(any(target_os = "android", target_os = "ios"))` 分支；它们是开发 fixture，不是产品状态。host 的平台能力报告不得把它们声明为真实 native 支持。
- Android 依赖继续由 Cargo 的 Android target 区段控制，JNI 与 `mobile_plugin_handle` 的使用仍受 Android cfg 约束。没有用运行时布尔值代替这层编译隔离。
- iOS state 不持有虚构 PluginHandle；本阶段所有 iOS 错误分支只消费输入并返回错误，不进入 JNI、host fixture 或不存在的 Swift selector。
- 返回具体 DTO 的分支从函数结果推导泛型类型；先拒绝再到公共 `Ok(())` 的命令显式使用 `::<()>`，避免目标分支中未约束的错误 helper 类型。
- `open_file_native` 保留现有 action 参数校验，并把 `share` 与默认 `view` 分别判定；不把文件预览授权扩大为分享、导出或 APK 安装能力。
- iOS 尚未取得原生租约、选择文件或建立临时资源，所以错误返回不产生取消/清理 owner。接入 Swift 时必须沿已有 owner 补回成功和释放路径，不能只改 capability 为可用。

## 5. 已执行验证与阶段交接

2026-10-08 执行结果：

1. 在 `src-tauri/` 运行 `cargo check --locked -p tauri-plugin-vcp-mobile` 成功，host 检查耗时 30.97 秒。它不覆盖 iOS cfg 内代码的 Apple 编译与链接。
2. 只读比较 `system.rs`、`cli.rs`、`screen.rs`、`stream.rs` 与 `HEAD`：剔除本次新增的 iOS 分支、还原 host cfg 标签后，既有 Android/host 内容按空白归一化完全一致。此结果说明没有改写原有平台函数体，不替代行为测试。
3. 22 条 Android native grants 与 Phase 0 真实前端消费者集合完全一致，全部 permission identifier 可解析；另外保留 Android 返回失败路径使用的 core close 权限。所有 capability 只匹配 `main`，iOS/host 没有本插件 native grants。
4. 插件构建前后六个原有 dirty permission 文件 SHA-256 完全一致；`git diff --check` 对本子项修改通过。未编辑/重生成权限集合，没有新增或删除公开命令。

阶段总集成仍需完成 `pnpm check`、app 窗口门禁与能力消费验证。Phase 2 接 Swift registration/Channel 时保留本次 cfg 隔离；Phase 3/4 接入真实电量/文件/staging，Phase 5 接入 operation lease 时才增补相应 iOS grants。权限声明、成功结果、取消与资源释放必须随实际消费者一起完成。
