# Phase 1：验收与 Phase 2 交接

> 原验收：2026-10-08，**Phase 1 已完成**。施工基线 `489b3341`；下方交付/计数/验证保留当时结果，不重记为当前工作树验证。2026-10-09 更新第 4 节交接：Swift 已接入，统一能力表已删除，新增功能按最新审批。

## 1. 原阶段交付范围

- 平台能力 Rust/TS 四轴契约、启动先读、失败可重试；24 项能力由统一 owner 提供。
- Android/iOS/host 插件分支；42 条公开 endpoint 中 iOS 当前 11 条待实现、31 条不支持（`open_file_native` 另按 view/share 分意图），无 host 固定数据冒充 iOS 结果。
- main 分平台 ACL、Android 22 条实际消费的 native grants；保留 Android close fallback；app IPC 总闸显式拒绝非 main 窗口。
- 启动权限、APK 全链、CLI/Root/Distributed、录音/相机、保存/分享/导出（含邮件间接 guest 调用）同步门控 UI 和实际调用。
- data/support/cache/staging 目录按真实 owner 接到附件、DB、HTTP upload 和清理；Android 和 host 原位置保持。
- lifecycle phase/nativeSequence/snapshot/transitionEpoch 贯通 Kotlin → Rust → Vue；事件回放、乱序、重复和原生桥重建有对应处理。

文件级实现与边界见 01–06。没有新建业务状态树、第二套终态 owner、原生空壳成功接口或跨平台命令代理。

## 2. 2026-10-08 已执行验证

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

## 3. 原阶段审查中闭环的问题

1. **Tauri app ACL 例外**：插件权限收紧不能替代自定义 app command 窗口检查，已在原 IPC 总闸闭合。
2. **Android 返回授权**：保留 move-to-back 失败时的窗口关闭授权，避免平台拆文件后失去原 fallback。
3. **邮件导出间接调用**：命令通过 guest wrapper 导入，已从邮件页面追到 store，在远程取附件前检查 fileExport；本地正文与元数据继续可读。
4. **事件解码**：serde 的 unit `other` 无法接受配置事件的对象 payload，已按真实 producer 的 configuration/memory-pressure 明确处理并复验。
5. **目录注释与真实 API 不一致**：Android DB 继续使用原 app_config API，不按旧注释误迁移；Swift 将来必须消费 Rust 给定的 staging 路径，不能直接拿原生 cachesDirectory 少算 identifier 层。
6. **能力与命令分类一致**：Files 导出是待实现，完整 network telemetry 是延期；后续 network Channel 不借遥测字段表示支持。

## 4. 2026-10-09 当前交接

| 后续任务 | 已确定的输入/owner | 不得遗漏 |
|---|---|---|
| Swift Package/binding/注册 | Phase 2 已有真实 iOS handle、minimum 15.0、可重放工程输入与正常 SwiftPM 解析 | 按当前 Tauri 2.12.1/tao 0.37.1 取得 G1 编译/链接，旧 host 结果不替代 |
| 平台身份 | `src/core/utils/platform.ts` 同步读取 plugin-os | 旧 `infra/platform.rs`/Store/types/query 已删除；Vue 直接平台分支，真实权限/任务状态仍归实际 owner |
| 生命周期接入 | Swift producer/subscribe/bootstrap 与 Vue 已接通 | 保留 sequence/epoch、首次真实 active、R3 告知和旧响应丢弃，不重复建立另一条观察链 |
| 迟到原生完成 | 事件注册独立 receiver 与一个在途槽位 | 保留最终回调接收；能力查询槽位已撤除，不因历史设计重新引入 |
| G1 | 阶段性手动 GitHub Actions | 取得 Apple 编译/链接证据；本轮未执行 Apple build、签名或设备操作 |

Phase 3 接 Chat/Sync 有界收尾、LAN、共同权限、本 App 通知、电量/空间/网络与 Distributed。Phase 4 接 Files/PHPicker/ImageIO、拍照/相册、预览/导出、双向分享与 WebKit；旧分享/通知/完整遥测延期已由审批覆盖。Phase 5 以 SSE 后台持续接收为重点，其余任务尽力后台，沿同一业务 owner 处理进度和单次终态。当前电量未知继续警告，原生功能待接不宣称 iOS 完整业务已运行通过。

## 5. 证据边界

原 Phase 1 没有生成 APK、操作设备、测包体积或 Apple 编译；当时尚无 Swift。后续 Swift 源码接入也不证明可安装产物已完成，G1/G2 仍待真实 Apple 结果。历史 capability 测试已随架构变更调整/移除，不为保留旧断言恢复退役接口。
