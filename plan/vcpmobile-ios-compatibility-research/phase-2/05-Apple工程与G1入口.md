# Phase 2：Apple 工程与 G1 入口

> 本文保留首次施工记录。下述 Swift shim、三 root 门禁和源码断言已按用户要求移除；当前 G1 直接执行工具链并收集原始诊断，见 [10-G1流程精简](./10-G1流程精简.md)。当前 CLI 为 2.12.1、官方 tao 为 0.37.1；旧门禁拒绝 log 的历史复现见 [08 的 R1](./08-代码复审与遗漏清单.md)。

> 2026-10-08。已实现可重放工程输入和独立手动 workflow；本轮未推送、未触发 Actions、未执行 Apple 编译。Windows 检查结果与待执行 G1 分开记录。

## 1. Casper 裁决与边界

G1 只完成插件接入所需的 device debug archive、符号/资源/配置检查及证据留存。维护少量生成树外的输入和一个 Python 标准库脚本；继续由 CLI 生成工程、执行一次 frontend build、驱动 Rust/Swift 与 archive。用户自签 `.app.zip`/`.unsigned.ipa`、Bundle ID 改写和 G2 release 打包留给 Phase 6。

入口是 [ios-g1.yml](../../../.github/workflows/ios-g1.yml)，仅 `workflow_dispatch`、`contents: read`、90 分钟超时和同 ref cancellation。无 push/PR/schedule trigger，也未读取或改写 Android ci/release。checkout 禁止持久化凭据，三个官方 action 固定 commit；输入、Node 运行方式及上传行为已按各自 `action.yml` 核对。[checkout](https://github.com/actions/checkout/blob/34e114876b0b11c390a56381ad16ebd13914f8d5/action.yml)、[setup-node](https://github.com/actions/setup-node/blob/49933ea5288caeca8642d1e84afbd3f7d6820020/action.yml)、[upload-artifact](https://github.com/actions/upload-artifact/blob/ea165f8d65b6e75b540449e92b4886f43607fa02/action.yml)。

## 2. 历史固定输入记录（精简前，非当前断言清单）

| 对象 | 本阶段选择 | 实际检查 |
|---|---|---|
| runner | `macos-15` arm64 | G1 检查 host architecture，保存 ImageOS/ImageVersion 和 sw_vers |
| Xcode | `/Applications/Xcode_26.2.app/Contents/Developer`，26.2 / 17C52 | 路径、version 和 build 必须一致 |
| iPhoneOS SDK | 26.2 | `xcrun --sdk iphoneos --show-sdk-version` |
| minimum | 15.0 | Tauri config、Swift package、环境/Xcode 设置、最终 Info.plist |
| target/profile | `aarch64-apple-ios` / debug | CLI target 参数为 `aarch64`，最终 Mach-O 为 arm64 |
| Rust | 仓库 `rust-toolchain.toml` | rustup 读取仓库版本，仅额外安装 device target |
| Node/pnpm/CLI | 24.14.1 / 12.6.0 / 2.11.4 | workflow 固定安装，脚本复核实际版本 |
| XcodeGen | 2.44.1 | 官方 zip 的 SHA-256 固定于 `g1-inputs.json`；下载校验后解压，记录 binary version |

官方 runner 库存在本次查阅时列出所选 Xcode、SDK 和可用 iOS runtime；GitHub 文档将 `macos-15` 列为 arm64。这是输入选择的依据，不能替代某次 job 的实际库存。[runner 库存](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md)、[runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

锁定 CLI 的 device build 仍检查已安装的 iOS runtime。因此 G1 读取 `simctl list runtimes --json` 并检查 available iOS 项，但不启动 Simulator，也不建设设备/Simulator 旅程。G1 debug 用进程内 `CARGO_PROFILE_DEV_DEBUG=1` 和 `CARGO_PROFILE_DEV_STRIP=false` 保留链接诊断；不改 Android profile。[CLI build](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/mobile/ios/build.rs)。

## 3. 已撤销的 SwiftPM resolution 设计（历史）

初次设计依据 `swift-rs@1.0.7` 的独立 `swift build --build-path`，误把实际 root 限定为 Tauri、opener、VCP 三个，遗漏了 log；该错误及直接拒绝的复现见 08 R1。以下保存旧机制的来源，不再要求实施或修复这套集中锁定流程。

历史 `ios/Package.resolved`（现已移除）固定 SwiftRs `1.0.7`，revision `f64a4514de07f450ec5b6aa297624cd3479d9579`，已通过上游 tag 的只读 `git ls-remote` 核对。VCP manifest 同时 exact；当时 G1 Swift shim 在三个 root 分别预置该 resolution，调用真实 Swift 并附加 `--force-resolved-versions`，成功后校验 lock 中所有 pins 与实际 `checkouts/swift-rs` 的 HEAD。未知 root 或调用形状变化都失败；不改依赖 manifest。该套流程已按 10 撤下。

opener 2.5.4 的 registry 包已自带 v1 `Package.resolved`，锁 SwiftRs 1.0.6（`b5ed223fcdab165bc21219c1925dc1e77e2bef5e`）。本阶段显式将这一已审计旧输入迁移至 1.0.7：要求 root 的父目录为 `tauri-plugin-opener-2.5.4` 且旧 lock SHA-256 为 `daf0cdf825417e400e2898d47c1de6912a112265f0fb14c056f46735e728b9c8`，并保存旧 lock/hash 到该 root 的 evidence。其他已有不匹配 lock 一律失败。Tauri/VCP root 当前不自带 lock。

shim 路径通过 PATH，真实 Swift/lock/evidence 通过 `TAURI_VCP_*` 传入；锁定 CLI 的 `mobile::env_vars` 明确转发 PATH 与 `TAURI*`，`xcode_script` 恢复这些变量。G1 最后强制收齐三个 root 的 revision 证据，防止路径被 Xcode 重置后静默绕过 gate。[CLI 环境转交](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/mobile/mod.rs)。

上述集中 lock、迁移白名单、shim 与 revision 集合检查均已删除。当前各 package 正常解析并编译；实际 SwiftPM 和 Swift 结果仍待 G1，不把旧 JSON 检查结果称为当前构建成功。

## 4. 历史装配记录与当前保留输入

| 源输入/owner | 生成动作 | 后置检查 |
|---|---|---|
| `tauri.ios.conf.json` | CLI 自动合并，minimum 15.0 与 Network framework | minimum 一致、真实编译/链接 |
| `Info.ios.plist` | CLI build 自动合并 | 单项 TaoScene/UIWindowScene/TaoSceneDelegate，multipleScenes=false |
| 官方 tao 0.37.1 | 已替代原 0.35.3 vendor 补丁；窗口恢复由 app `ios_window` 接入 | 06 保留旧修正来源，11–13 记录当前 R2；G1 不宣称系统回调已运行 |
| CLI `project.yml` | 保留 CLI 原始生成内容 | overlay 不改原 spec |
| `project.vcp.json` | additive include 原 spec，加目标设置与隐私 resource | 重放不重复，未知 target 格式拒绝 |
| 现有 `icons/ios/` | 生成 AppIcon catalog；旧尺寸/槽位等值断言已删除 | 保存实际编译资源供审查；完整图像/alpha 产品审计仍归 G2 |
| `ios/PrivacyInfo.xcprivacy` | 复制到 VCPResources，显式加入 resources build phase | 保存实际 bundle 文件和 privacy 供审查，不恢复静态等值门禁 |

锁定 CLI 通过 XcodeGen 构造工程；XcodeGen spec 可用 JSON、`include` 默认数组追加，因此 overlay 不复制完整上游模板，只添加本项目所需差异。[CLI 模板](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/templates/mobile/ios/project.yml)、[XcodeGen include 规则](https://github.com/yonaskolb/XcodeGen/blob/2.44.1/Docs/ProjectSpec.md#include)。

隐私清单当前声明应用容器文件元数据 `C617.1` 与计时 `35F9.1`，对应共享 Rust 文件/计时路径；Phase 2 Swift 自身仅 Scene/Application、NWPathMonitor 和 Channel，不添加 disk/UserDefaults reason。没有伪造完整“零数据收集”声明；Phase 3–6 按最终实际 API 与业务数据用途继续审计。本阶段只建立当前 required-reason 输入和真实资源装配检查。[Apple API reasons](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons)、[Apple 声明要求](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)。

## 5. 当前 G1 执行与失败归属

1. 从当前 checkout 安装 frozen pnpm dependencies，消费实际维护输入。
2. 选择 Xcode、记录实际工具/SDK/原生环境，安装 device Rust target；版本与 runtime 要求由真实工具执行诊断，不重复比较配置镜像。
3. 校验并安装固定 XcodeGen；`pnpm tauri ios init --ci --skip-targets-install`，重放 overlay，再 XcodeGen generate。
4. 直接使用正常 SwiftPM，执行 `pnpm tauri ios build --debug --target aarch64 --archive-only --no-sign --ci -- --locked`。
5. 收集实际 archive、bundle 文件列表、Info.plist/已有 privacy 以及 lipo、nm、otool 原始输出；结合源码审查实际产物，不用人工预期集合判定成功。符号可成为 local/hidden，不为诊断改变 Swift visibility。
6. 用 `ditto` 保留 archive，输出 manifest、摘要与阶段日志；workflow 始终尝试保存已取得诊断。`built` 表示工具链已产出归档，不代表产品内容或运行行为已经验收。

脚本限定在约定 GitHub Actions/macOS 环境和新的生成树，遇到旧树不自动删除。没有签名凭据输入；工具失败记录具体阶段，诊断采集失败不丢弃已有归档。当前流程以 10 和真实脚本为准，没有自动换 Xcode、升级依赖或重新触发机制。

## 6. 精简前本地历史证据（2026-10-08）

- `python -B src-tauri/ios/scripts/g1.py check`：通过，minimum/Scene/隐私/resolution/18 icon slots。
- `python -B src-tauri/ios/scripts/test_g1.py`：8 项通过，覆盖重放幂等、CLI spec 保留、路径越界、模板变化、多 Scene 拒绝、Swift revision/依赖漂移与格式升级、已知旧锁迁移与未知锁拒绝。
- `git diff --check`：通过。
- workflow YAML：使用本机已有 PyYAML 解析通过，确认仅 workflow_dispatch；未触发远端执行。
- XcodeGen 官方 `2.44.1/xcodegen.zip`：只读下载计算 SHA-256，为 `a2e905fb68446e9bb4008cdfe2e13e3f176d0cbcca828b71770f8e53fca91b73`，未执行其中二进制。

上述 8 项和 `g1.py check` 属已撤销门禁的历史执行，不是当前工作清单。精简后检查记录见 10；尚无 Actions run、Apple archive 或 SwiftPM 实际编译结果，准备好入口不等于已取得 G1 证据。
