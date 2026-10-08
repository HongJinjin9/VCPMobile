# Apple 工程输入与 G1

> 2026-10-08：按用户要求暂停 iOS 实施与 G1。

此目录保存生成树之外的可重放输入；`gen/apple/` 继续由锁定的 Tauri CLI 生成并忽略。G1 只由 [独立手动 workflow](../../.github/workflows/ios-g1.yml) 执行，生成 unsigned device debug archive。它不是发布或用户安装入口。

## 日常检查

```text
python -B src-tauri/ios/scripts/g1.py check
python -B src-tauri/ios/scripts/test_g1.py
```

`check` 读取 Tauri minimum、Scene plist、Swift resolution、隐私清单及 18 个 iPhone/iPad AppIcon slot 的 PNG 尺寸；测试检查 overlay 重放、输出目录边界和依赖漂移拒绝。两者均不调用 Apple 编译工具。

## 维护输入

| 文件 | 所有权 |
|---|---|
| `../tauri.ios.conf.json` | iOS 15.0、Network framework；不覆盖 Android 配置 |
| `../Info.ios.plist` | 单 Scene manifest，消费官方 tao 0.37.1 的 Scene 修复；Tauri build 自动合并 |
| `g1-inputs.json` | runner/Xcode/SDK、工具版本及 XcodeGen 发布包 SHA-256 |
| `Package.resolved` | 三个独立 Swift package root 共同使用的 SwiftRs revision |
| `PrivacyInfo.xcprivacy` | 当前文件元数据和计时 API 的 required reasons；后续原生 API/数据使用变化需重新审计 |
| `scripts/g1.py` | 检查输入、重放工程、G1 archive、产物诊断及 manifest |
| `scripts/swift-lock.py` | 强制 SwiftPM 使用受控 resolution，检查实际 checkout revision |

Swift plugin 的源文件仍归 `../plugins/vcp-mobile/ios/`。G1 不修改 registry 的 `Package.swift`，向各构建 root 预置 `Package.resolved`，在 Tauri/opener/VCP 三条 `swift build` 上附加 `--force-resolved-versions`。opener 2.5.4 自带的旧 1.0.6 lock 仅在目录版本和完整 SHA-256 同时匹配时迁移，并保存原 lock 证据；其他不匹配 resolution 直接失败。

Rust `swift-rs` 升至 1.0.8；SwiftPM 的 `SwiftRs` 保持 1.0.7 / `f64a4514de07f450ec5b6aa297624cd3479d9579`。两者是独立解析图，1.0.8 的发布提交未修改 Swift 源码或 Package.swift，官方尚无 SwiftPM 1.0.8 tag。现有 Xcode 26.2 仍走原 `swift build --build-path` 调用，因此保留三 root 的受控 resolution 与 opener 旧锁迁移。

## 工程重放

Actions 中先安装 device Rust target，执行 `pnpm tauri ios init --ci --skip-targets-install`，再执行 overlay。overlay 新增 `project.vcp.json`，通过 XcodeGen `include` 合并 CLI 的 `project.yml`；补充单一隐私 resource、device family、minimum 和 G1 诊断选项，并从现有 `icons/ios/` 重建 AppIcon catalog。对相同输入重复 overlay 不会累加 resource，也不改写 CLI spec。

`build` 要求 GitHub Actions macOS arm64 环境与不存在的 `gen/apple`，不会自动清除用户目录。选择的 Xcode/SDK 不存在或发生版本变化即报告错误，维护者根据新库存重新审计后更新输入。Swift shim 只在该次 G1 的 PATH 中启用，参数经 Tauri 的 `TAURI_*`/PATH 转交机制传播。Android profile 和环境不受影响。

成功条件包括：device arm64、minimum 15.0、iPhone/iPad、单 Scene、app 根目录真实包含隐私清单且内容相同、Assets.car、VCP 初始化符号定义（`nm -U -j` 完整行匹配，不要求 external）、三个 Swift build root 的 revision 证据、无主程序签名和无 provisioning profile。成功后用 `ditto` 保存 `.xcarchive.zip` 与 SHA-256；失败保留已取得的 manifest 和对应阶段日志。G1 不生成用户 `.ipa`。

构建后只记录实际得到的结果。当前本地源码检查不代表 G1 已运行；详见 [Phase 2 工程记录](../../plan/vcpmobile-ios-compatibility-research/phase-2/05-Apple工程与G1入口.md)。
