# Tauri 2.12：已有 iOS 输入与 tao 补丁撤销

> 2026-10-08。用户暂停 iOS 兼容，授权先评估并在无阻断时升级 Tauri。本记录只处理已有 Phase 2 接入与新依赖的兼容关系；未继续实现 iOS 功能、执行 Apple 构建或触发 G1。

## 1. Casper 结论

从发布源码看，原 tao 补丁的两个目的均已由官方 tao 0.37.1 覆盖，可以随 Tauri 2.12.1 升级撤销 path override 和 vendor 副本。保留应用现有单 Scene plist、Swift adapter、两个有界原生请求槽位和一次长期 Channel。源码审计没有发现必须保留私有 tao 分支或重写 Swift 插件的理由；实际 Apple 编译仍留在暂停的 G1，不能用本轮 host/Android 结果关闭它。

Tauri runtime-wry 2.12.0 接受 tao 0.37 与 wry 0.57；这是正常依赖升级，不需要同时保留旧 tao。版本关系以 [官方 runtime-wry manifest](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.0/crates/tauri-runtime-wry/Cargo.toml) 和最终应用 Cargo.lock 为准。

## 2. tao 三处入口复核

直接读取发布包 `tao-0.37.1.crate`，SHA-256 为 `f37f381f4e048e6cdf038b5705f8cf14ad108279d46eb968140a7b291aba9400`；下列三个 iOS 文件与官方 `tao-v0.37.1` tag 逐字节一致。

| 入口 | 官方 0.37.1 行为 | 原补丁目的是否覆盖 |
|---|---|---|
| `scene.rs::scene_lifecycle_enabled` | 检查 `UIApplicationSceneManifest` 是否存在；多 Scene 权限单独读取 UIKit `supportsMultipleScenes()` | 覆盖。现有 plist 是已校验的字典，`UIApplicationSupportsMultipleScenes=false` 继续保持 |
| `view.rs::create_delegate_class` | 无条件注册 Scene configuration 回调；未采用 Scene 的应用不会收到这个 UIKit 回调 | 覆盖，不再用多窗口权限挡住单 Scene delegate |
| `app_state.rs::did_finish_launching` | 有 manifest 时等待首次 Scene connect；`on_app_ready` 另有一次性保护 | 覆盖，首个应用窗口不会因 multiple-scenes=false 提前走旧路径 |
| `view.rs::create_window` | 优先绑定未初始化 Scene；仅 UIKit 允许多 Scene 时请求新 Scene，否则绑定已有 Scene；尚无 Scene 的窗口保留到连接时再绑定 | 覆盖，窗口绑定与多窗口权限独立 |
| `configuration_for_connecting_scene_session` | 保留连接 session 的 role、设置 `TaoSceneDelegate`，返回 `Retained::autorelease_ptr(config)` | 覆盖返回对象保活问题 |

来源：[scene.rs](https://github.com/tauri-apps/tao/blob/tao-v0.37.1/src/platform_impl/ios/scene.rs)、[view.rs](https://github.com/tauri-apps/tao/blob/tao-v0.37.1/src/platform_impl/ios/view.rs)、[app_state.rs](https://github.com/tauri-apps/tao/blob/tao-v0.37.1/src/platform_impl/ios/app_state.rs)。

新版动态 configuration 使用空名称与连接 session 的实际 role；应用 plist 中 `TaoScene` 是静态配置名称，`TaoSceneDelegate` 仍为实际类名。保留现有静态配置，不再沿用旧文档中“动态返回值也名为 TaoScene”的事实描述。

新版 Scene delegate 增加了 `Resumed`/`Suspended` 与断开时的窗口事件，但仍不能代替应用的 active/inactive/background DTO。现有 UIKit notification → Swift Channel → Rust reducer 继续拥有业务生命周期，不在升级时新增第二个 owner。

旧补丁来源留在 [Phase 2 历史审计](../vcpmobile-ios-compatibility-research/phase-2/06-Scene与框架审计.md)：发布基线 tao 0.35.3，archive SHA-256 `d1c93047acf68669466a34690ac58cca7010bd1b201e1ec86f1fd0a75d3dd4a9`，只修改 `ios/{scene,view,app_state}.rs`。本次以官方发布源码替代，原始工作树由升级任务开始时的备份保留。

## 3. Swift API 与接收端生命周期

Tauri 2.12.0 的 `mobile/ios-api/Package.swift`、`Sources/Tauri/Plugin/Plugin.swift`、`Tauri.swift`、`Invoke.swift`、`Channel.swift` 与 2.11.5 逐字节相同；进一步核对 2.12.1 发布源码，这五个文件仍与 2.12.0 逐字节相同。现有 `load(webview:)`、selector 参数解码、`Invoke.resolve/reject`、Channel 发送及插件初始化无需改接口。[官方 Swift API](https://github.com/tauri-apps/tauri/tree/tauri-v2.12.1/crates/tauri/mobile/ios-api)

Rust 原生调用仍在回调中对 receiver 发送结果并 `unwrap`；原生 Channel 注册表仍无释放入口。因此保留现有 `receive_native` 底层任务、每个 selector 最多一个在途以及 bootstrap 单次订阅；调用方超时只停止等待，不丢弃原生 receiver。JavaScript IPC Channel 的队列修复并不等于原生 Channel 注册表已经可注销。[官方 mobile.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/plugin/mobile.rs)

wry 0.57.0 发布包 SHA-256 为 `a819957a01b3119af85e638a38d242af76dbc87d130dca67bfd0441072e21ff0`，Apple 依赖转为 objc2 0.6.4 / objc2-* 0.3.2。VCP Swift 插件通过 Tauri API 接入，没有直接依赖这些 Rust 内部类型；Apple 分支的编译与链接仍需未来 G1。[wry manifest](https://github.com/tauri-apps/wry/blob/wry-v0.57.0/Cargo.toml)

## 4. Rust swift-rs 与 SwiftPM SwiftRs 分别锁定

| 解析图 | 升级后输入 | 依据 |
|---|---|---|
| Cargo `swift-rs` | 1.0.8 | Tauri 2.12.1 的 Rust 构建依赖 |
| SwiftPM `SwiftRs` | 1.0.7，revision `f64a4514de07f450ec5b6aa297624cd3479d9579` | 保留实际发布 tag、VCP exact 与三 root 的受控 resolution |
| opener | 保留 2.5.4 | 仍使用已审计的 1.0.6 旧锁迁移规则 |

实时核对官方 tags，SwiftPM 没有 1.0.8 tag，不能因为 Rust crate 升级就把 `.exact` 改成不可解析版本。Rust 1.0.8 发布包的 VCS commit 是 `fd82965ee1a55b2777122a9ac42a581c613327ac`；与 1.0.7 tag 对比，没有修改 Package.swift 或 `src-swift`。Rust 侧主要增加构建兼容及指针类型支持，现有共享类型布局未变。Tauri Swift manifest 仍允许 `from: "1.0.0"`。[官方提交差异](https://github.com/Brendonovich/swift-rs/compare/1.0.7...fd82965ee1a55b2777122a9ac42a581c613327ac)、[Tauri Swift manifest](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/mobile/ios-api/Package.swift)

两个 Rust 发布包已直接比较：1.0.7 SHA-256 `4057c98e2e852d51fdcfca832aac7b571f6b351ad159f9eda5db1655f8d0c4d7`；1.0.8 为 `e45c444e496845d3f2a351146bff59aae4975b2280238df1dfaa0c7d1846f38e`。1.0.8 在 Xcode 27 才使用新的 `--triple`、产物查找与 C 符号处理；现有 Xcode 26.2 继续走 `swift build --build-path`，兼容现有 shim。没有借此更换 Xcode/SDK 或 minimum 15.0。

## 5. 既有工程最小维护

- `ios/g1-inputs.json` 的 CLI 断言更新为 2.12.1，与根 package 的固定版本对应；脚本不放宽版本匹配。
- SwiftPM exact/resolution 仍为 1.0.7；在 VCP Package.swift 与工程 README 说明它和 Rust crate 版本独立。
- opener 2.5.4 旧锁的目录版本 + SHA-256 白名单、未知漂移拒绝与原输入证据保留逻辑不变。
- CLI 2.12.1 的 XcodeGen 目标仍为 `<name>_iOS`，overlay 继续 additive include。上游新增 Externals `*.a` 排除规则由 CLI 新模板自然提供，不复制模板到项目。
- `--archive-only`、`--no-sign`、device runtime 预检查仍存在；没有执行这些命令。暂停阶段不改 workflow、不运行 Actions。

已逐字节比较 CLI 2.12.0 与 2.12.1 的 iOS `project.yml`、`mobile/ios/build.rs`、`mobile/mod.rs`，三者没有变化；补丁升级不引入额外模板、归档参数或环境转交迁移。

来源：[CLI iOS 模板](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-cli/templates/mobile/ios/project.yml)、[CLI build](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-cli/src/mobile/ios/build.rs)、[CLI mobile](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-cli/src/mobile/mod.rs)。

## 6. 验证边界

已执行 `python -B src-tauri/ios/scripts/g1.py check`，退出 0，确认 minimum 15.0、单 Scene、18 个 icon slot 与 CLI/Swift 输入一致；`python -B src-tauri/ios/scripts/test_g1.py` 的 8 项回归全部通过。相关文本 `git diff --check` 通过。

本项验证为发布源码比较、现有输入一致性检查与 Python 工程脚本回归；未执行 SwiftPM resolve、Swift 编译、Apple Rust 编译、archive、Simulator 或设备操作。升级的共享前端、Rust host 和 Android 验证由本任务其他记录汇总；旧 Phase 2 的通过项保留为历史证据，不挪用为新依赖通过项。
