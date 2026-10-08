# Tauri 2.12 升级评估与实施

> 2026-10-08。用户明确暂停 iOS 兼容开发，授权先评估 Tauri 升级，无阻断则直接升级；本任务使用 3 位子代理。当前状态：已升级至正式版 2.12.1，静态检查、前端回归、Android arm64 Debug APK 与插件 JVM 验证完成。升级时记录的 17 项既有失败已在用户另行授权的测试整理提交 `a0639f6c` 中分类处理；最新 Windows Rust 472 项、前端 503 项通过，Unix 专属用例未在本机执行。升级与阶段二按用户授权一并本地提交，未推送，iOS 保持暂停。

## 基线与保留边界

- 升级开始时 HEAD 为 `aff70257`；当时工作树含尚未提交的 iOS Phase 2 与更早的用户修改，不能恢复或清空。
- 已将开始时的 168 个修改/新增文件保存到仓库忽略目录 `temp/tauri-2.12-upgrade-baseline-20261008.zip`，逐文件校验 SHA-256；这是本逻辑任务唯一恢复快照，没有新增 Git 提交。
- 保留原有 `@iconify-json/carbon`、lockfile 对应内容、Windows manifest build.rs 修改及六个 permission 文件的原工作树内容。package/lock 因本任务必需更新，比较时区分本轮增量。
- 不操作设备、不构建或签名正式 Release、不 push、不触发 Actions。iOS 功能开发和 G1 保持暂停；已有 Swift/工程输入仅做新依赖兼容调整。

## 目标版本与迁移范围

| 对象 | 原实际/声明版本 | 本轮目标 |
|---|---|---|
| Tauri Rust / runtime-wry | 2.11.5 / 2.11.4 | 2.12.1 / 2.12.1 |
| npm CLI / API | 2.11.4 / 2.11.1 | 2.12.1 / 2.12.1，含本地插件 API 依赖 |
| tauri-build / tauri-plugin build | 2.6.3 / 2.6.3 | 2.7.1 / 2.7.1 |
| tao / wry | 本地 tao 0.35.3 / 0.55.1 | 官方 tao 0.37.1 / wry 0.57.0，已由 Cargo.lock 确认 |
| opener / log | 2.5.4 / 2.9.0 | 保留，除非解析或编译证明有必要变化 |
| Rust toolchain / app edition | 1.97.1 / 2021 | 保留；工具链满足 Tauri MSRV 1.90 |
| Gradle / AGP / Kotlin | 8.14.3 / 8.11.0 / 1.9.25 | 保留；已满足官方最低要求，迁移 compilerOptions DSL |
| Android SDK / minSdk / NDK | 36 / 26 / 29.0.14206865 | 保留 arm64 生产范围 |

官方已发布的 Tauri 2.12.0 使用 tao 0.37，因此旧的两个 iOS 补丁有官方替代。新版同时有 Android JNI 生成入口变化，必须通过真实 Tauri Android 构建重新生成 Kotlin bridge，不能只换 registry 路径后编译旧生成文件。本仓的 `TauriActivity.kt` 和 `tauri.build.gradle.kts` 实际受 Git 跟踪，正常生成产生的差异纳入本次升级；本机绝对路径 settings 仍被忽略。[发布说明](https://tauri.app/release/tauri/v2.12.0/)、[runtime manifest](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri-runtime-wry/Cargo.toml)。

随后通过 registry 和 GitHub 正式发布核实 2026-09-30 已发布 2.12.1；官网汇总页仍显示旧补丁。补充比较发布包与 tag 后确认移动端相关实现相同，最终采用 2.12.1 及配套 2.7.1。opener/log 保留原版，SwiftPM 的 1.0.7 与 Rust swift-rs 1.0.8 独立锁定，依据见 01/03。

## 三方评估与实施顺序

- **Melchior**：审查 Rust/MSRV、IPC 总闸、State、原生 receiver、Channel 和 JNI 类型；保持现有一次 offload、唯一 owner 与取消接收保护。
- **Balthasar**：审查 Android Activity 回调、进程生命周期、返回/Insets 与 JVM target；保留业务交互和 Android 生产参数，构建不能替代设备证据。
- **Casper**：确认官方 tao 已覆盖本地修复，撤销临时 vendor；检查现有 SwiftPM/G1 版本输入但不推进暂停的 iOS 任务，控制升级范围。

实施顺序为：保存基线 → 官方源码/版本评估 → 外科更新直接依赖与必要 Gradle DSL → 定向更新锁文件 → `pnpm check` → 前端与 Rust 回归 → Android arm64 Debug 构建及插件 JVM 回归 → 删除已被官方替代且与快照匹配的本地 vendor → 汇总证据和剩余限制。

详情见 [Rust 与 IPC 评估](./01-Rust与IPC评估.md)、[Android 构建与 JNI 评估](./02-Android构建与JNI评估.md)、[既有 iOS 输入与补丁撤销](./03-iOS既有输入与补丁撤销.md)、[最终验证与遗留问题](./04-验证结果与遗留问题.md)。这些记录中的“源码兼容”与实际构建/运行证据分开登记。

## 验证门槛

不因测试断言反向改变业务接口。若出现编译或行为回归，先追真实调用链并修复；遇到无法在当前授权和环境下解决的具体阻断，则如实记录并保留可恢复基线。Android Release 签名/设备旅程及 Apple G1 不冒充已完成。
