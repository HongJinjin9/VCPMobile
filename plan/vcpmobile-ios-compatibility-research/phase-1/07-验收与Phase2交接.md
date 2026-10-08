# Phase 1：验收与 Phase 2 交接

> 2026-10-08。**Phase 1 已完成，可进入 Phase 2**。施工基线 `489b3341`；实施结果对应包含本文的 Phase 1 提交，未推送远端。

## 1. 交付范围

- 平台能力 Rust/TS 四轴契约、启动先读、失败可重试；24 项能力由统一 owner 提供。
- Android/iOS/host 插件分支；42 条公开 endpoint 中 iOS 当前 11 条待实现、31 条不支持（`open_file_native` 另按 view/share 分意图），无 host 固定数据冒充 iOS 结果。
- main 分平台 ACL、Android 22 条实际消费的 native grants；保留 Android close fallback；app IPC 总闸显式拒绝非 main 窗口。
- 启动权限、APK 全链、CLI/Root/Distributed、录音/相机、保存/分享/导出（含邮件间接 guest 调用）同步门控 UI 和实际调用。
- data/support/cache/staging 目录按真实 owner 接到附件、DB、HTTP upload 和清理；Android 和 host 原位置保持。
- lifecycle phase/nativeSequence/snapshot/transitionEpoch 贯通 Kotlin → Rust → Vue；事件回放、乱序、重复和原生桥重建有对应处理。

文件级实现与边界见 01–06。没有新建业务状态树、第二套终态 owner、原生空壳成功接口或跨平台命令代理。

## 2. 已执行验证

| 检查 | 实际结果 | 证据范围 |
|---|---|---|
| `pnpm check` | 最终收尾通过，退出 0，Rust 检查无警告 | TypeScript + Rust host，不是 Apple 编译 |
| `pnpm test:run` | 59 个文件，502 项通过 | Vue/store/现有回归；含能力失败/重试、iOS 无原生命令、Android 原门禁与邮件导出 |
| Rust `platform::tests` | 3 项通过 | 实现状态不冒充授权/运行结果，iOS pending 与 host fixture 边界 |
| Rust `update_manager::tests` | 8 项通过 | APK 资产/校验/遗留清理与固定安装路径 |
| Rust `security_boundary_tests` | 9 项通过 | staging/canonical/direct-child，Windows 可执行场景；不包含 Unix symlink 专属用例 |
| Rust `high_speed_channel` | 5 项通过 | 上传路径与大小/输入处理 |
| Rust `lifecycle_` | 11 项通过 | native 顺序、快照身份及现有 linger/Chat 生命周期回归 |
| 插件 Rust `events::tests` | 1 项通过 | lifecycle 必需字段/phase 解码，configuration 与 memory payload 正确区分 |
| Kotlin `LifecycleBridgeTest` | 3 项通过，Gradle 编译成功 | pause/stop 合并、snapshot/live 字段、桥重建 sequence 不倒退 |
| Android Rust `cargo check --locked --offline --target aarch64-linux-android` | 退出 0，NDK 29/API 26 | 目标分支编译；复用已有 native 库缓存，不是 APK 构建/运行；环境见 04 |
| 命令抽取脚本（运行当前源码，不覆盖 Phase 0 快照） | 42 plugin / 176 app / 59 Kotlin；0 活跃未知命令，0 未匹配 selector，九组权限集合无差异 | 静态集合；app 新增能力查询、撤除旧前台写入入口，净数量不变 |
| 继承修改 SHA-256 | 原有 9 个路径全部保持 | package、pnpm lock、app build.rs、六个 permission 文件的原工作树内容未改动 |
| 文档相对链接 | 9 份阶段文档、34 个本地链接目标全部存在 | 使用现有 marked 解析，排除代码文本和外部链接 |
| `git diff --check` 与新增能力模块 Rust 格式检查 | 通过 | 补丁空白与该模块格式；不替代行为验证 |

Phase 0 的 `--check` 是历史源码快照核对，本阶段生产源码已变化，不能覆盖其 evidence 或将不匹配当作产品失败。本阶段直接运行抽取器审计当前入口，并保留旧阶段证据。

## 3. 审查中闭环的问题

1. **Tauri app ACL 例外**：插件权限收紧不能替代自定义 app command 窗口检查，已在原 IPC 总闸闭合。
2. **Android 返回授权**：保留 move-to-back 失败时的窗口关闭授权，避免平台拆文件后失去原 fallback。
3. **邮件导出间接调用**：命令通过 guest wrapper 导入，已从邮件页面追到 store，在远程取附件前检查 fileExport；本地正文与元数据继续可读。
4. **事件解码**：serde 的 unit `other` 无法接受配置事件的对象 payload，已按真实 producer 的 configuration/memory-pressure 明确处理并复验。
5. **目录注释与真实 API 不一致**：Android DB 继续使用原 app_config API，不按旧注释误迁移；Swift 将来必须消费 Rust 给定的 staging 路径，不能直接拿原生 cachesDirectory 少算 identifier 层。
6. **能力与命令分类一致**：Files 导出是待实现，完整 network telemetry 是延期；后续 network Channel 不借遥测字段表示支持。

## 4. Phase 2 的具体输入

| 后续任务 | 已确定的输入/owner | 不得遗漏 |
|---|---|---|
| Swift Package/binding/注册 | Phase 0 DEP-02–06/08–10；当前 plugin iOS marker | minimum 15.0、product 与符号、SwiftPM resolution、tao 单 Scene gate、可重放配置 |
| 原生能力查询与 Channel | `infra/platform.rs` + plugin events DTO | 实现后才改对应 implementation；授权/运行状态必须来自真实观察，不能统一置 granted/available |
| 生命周期接入 | `NativeLifecycleEvent`、Rust 排序器、原 transition owner、Vue reducer | 同时接 Swift producer/subscribe/bootstrap，并把相关当前 Android-only cfg 精确扩到 iOS；sequence 不代替 epoch；首次真实输入前 snapshot=null |
| 迟到原生完成 | 既有 tauri `run_mobile_plugin_async` 接收边界 | 保留最终回调接收，业务取消由 generation 丢弃；不直接丢 receiver 引发上游 unwrap |
| G1 | 阶段性手动 GitHub Actions | 取得 Apple 编译/链接证据；本轮未执行 Apple build、签名或设备操作 |

Phase 3 继续 iOS Chat/Sync 的有界 cancel/stop/join/flush、根返回完整旅程与 Sync loopback 移动策略；当前 `is_android` 配置仍不能表示所有移动平台。Phase 4 继续原生 Files/PHPicker/ImageIO、导出/外部打开、staging ticket/取消以及 WebKit 单位。Phase 5 继续真实后台任务、进度与单次终态。当前手动 Sync 电量未知仍按原语义警告继续，原生前台租约未接入时真实失败，不宣称 iOS Sync 已可用。

## 5. 证据边界

Android 编译与定向测试不能替代设备行为结论；本轮未生成 APK、操作设备或测包体积。iOS 仍未接 Swift、未经过 Apple 编译，Phase 1 完成仅代表共享契约和平台入口隔离可交给 Phase 2，不代表实验产物已可安装。
