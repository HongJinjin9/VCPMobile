# Apple 工程输入与 G1

> 2026-10-08：按用户要求精简 G1，移除重复人工结论的校验门禁；Apple 构建仍未执行。

此目录保存生成树之外的可重放输入；`gen/apple/` 继续由锁定的 Tauri CLI 生成并忽略。G1 只由 [独立手动 workflow](../../.github/workflows/ios-g1.yml) 执行，生成 unsigned device debug archive。它不是发布或用户安装入口。

## 使用方式

```text
# 手动 Actions 内执行
python3 src-tauri/ios/scripts/g1.py build
# 修改工程生成脚本后，可在本地验证文件写入行为
python -B src-tauri/ios/scripts/test_g1.py
```

G1 执行真实编译、链接和归档，保留输出供人工分析；没有独立的 `check` 命令，也不重复运行源码/配置断言。保留的两项本地测试只检查 overlay 不改写 CLI 文件、不越界写入，且不在 G1 workflow 中运行。

## 维护输入

| 文件 | 所有权 |
|---|---|
| `../tauri.ios.conf.json` | iOS 15.0、Network framework；不覆盖 Android 配置 |
| `../Info.ios.plist` | 单 Scene manifest，消费官方 tao 0.37.1 的 Scene 修复；Tauri build 自动合并 |
| `g1-inputs.json` | 选择 Xcode 的路径、XcodeGen 下载地址和下载完整性摘要 |
| `PrivacyInfo.xcprivacy` | 当前文件元数据和计时 API 的 required reasons；后续原生 API/数据使用变化需重新审计 |
| `scripts/g1.py` | 重放工程、真实 G1 构建、归档收集及原始诊断 |

Swift plugin 的源文件仍归 `../plugins/vcp-mobile/ios/`。构建直接使用 Tauri/SwiftPM 的正常依赖流程，不拦截 `swift`，不维护构建包白名单，不向 registry 预置或改写 lock。Cargo/pnpm 的正常锁文件和 VCP Swift manifest 的依赖约束继续生效。

Rust `swift-rs` 与 SwiftPM `SwiftRs` 是独立依赖。各 Swift root 按自己的 manifest 和原有 lock 解析；不再宣称所有 root 被额外脚本统一到同一 revision。解析、编译或链接出现具体错误时，根据真实构建输出处理。

## 工程重放

Actions 中先安装 device Rust target，执行 `pnpm tauri ios init --ci --skip-targets-install`，再执行 overlay。overlay 新增 `project.vcp.json`，通过 XcodeGen `include` 合并 CLI 的 `project.yml`；补充隐私 resource、device family 和 G1 诊断选项，并从现有 `icons/ios/` 重建 AppIcon catalog。minimum 读取 `tauri.ios.conf.json`；不在 G1 配置重复维护。对相同输入重复 overlay 不会累加 resource，也不改写 CLI spec。

`build` 仅允许在 GitHub Actions macOS 中执行，要求 `gen/apple` 尚不存在，避免覆盖已有工程。workflow 选择 runner、Node/pnpm，配置选择 Xcode；脚本记录实际工具版本，不再用第二套预期值拒绝版本变化。编译目标仍为 device arm64，使用 `--no-sign`，并清除子进程环境的签名输入。下载摘要、解压路径/符号链接和 overlay 写入边界保护保留。Android profile 和环境不受影响。

编译成功后用 `ditto` 保存实际 `.xcarchive.zip`，manifest 记录归档摘要；同时收集 bundle 文件列表、Info.plist、已有隐私清单及 `lipo`/`nm`/`otool` 原始输出。不对 Bundle ID、Scene、图标、minimum、符号或包集合写第二套预期断言。诊断采集失败写入 `diagnosticErrors`，仍保留已生成归档；真实构建/归档收集失败则正常失败。

manifest 的 `status=built` 仅表示构建和归档收集成功，产物内容由人工结合源码与诊断判断。workflow 无论构建是否成功都尝试上传已有日志。G1 不生成用户 `.ipa`。

构建后只记录实际得到的结果。当前本地脚本验证不代表 G1 已运行；清理范围见 [G1 流程精简记录](../../plan/vcpmobile-ios-compatibility-research/phase-2/10-G1流程精简.md)。
