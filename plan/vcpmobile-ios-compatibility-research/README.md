# VCPMobile iOS 兼容适配专项研究

> 修订：2026-10-07。源码基线：`4c6e25bb`，VCPMobile `1.1.6`。
>
> 目标：同一 Vue/Rust 核心的 iPhone/iPad 实验性客户端；开发采用源码与编译语义推演，产物供用户自行签名。

## 分期实施工作区（2026-10-08 启动）

2026-10-08：Tauri 2.12.1 升级已完成；iOS 兼容开发与 G1 仍保持暂停。

本目录 00–09 保留专题研究。每个 Phase 使用独立目录，在阶段启动时按当时生产代码重新形成子规划、审计和验收记录；Phase 0/1 已完成，Phase 2 源码与本地验证已完成、G1 待执行，Phase 3–6 仍为阶段入口。

| 工作区 | 当前职责 |
|---|---|
| [Phase 0](./phase-0/README.md) | 已完成输入与目标源码审计；具体证据和后续问题见阶段验收记录 |
| [Phase 1](./phase-1/README.md) | 已完成平台能力、cfg/ACL、目录与生命周期契约；验证与下一阶段输入见阶段 07 |
| [Phase 2](./phase-2/README.md) | 已接入 Swift、Channel、生命周期与可重放工程；本地检查通过，G1 Apple 构建待执行 |
| [Phase 3](./phase-3/README.md) | 前台核心 |
| [Phase 4](./phase-4/README.md) | 原生文件/图片与 WebKit 交互 |
| [Phase 5](./phase-5/README.md) | 尽力后台与单次终态 |
| [Phase 6](./phase-6/README.md) | G2 集中验收与用户自签产物 |

Phase 0 已同步 [移动端 UI 规范](../../docs/MOBILE_UI_COMPATIBILITY.md)，并按锁定依赖将 minimum 15.0 从候选收束为工程基线；配置应用与编译核验仍属于 Phase 2/G1。研究正文中的历史“候选/待同步”措辞以这次实施记录为后续输入，不代表 iOS 已实现。

## 研究目标与开发方式

本系列给出 iOS 适配的可施工方案。开发与验收固定采用 Windows 源码审计和阶段性 GitHub Actions；项目现在及后续均不建设 iOS 实机测试体系。研究从锁定依赖源码、框架模板、API 声明和语言规则恢复目标平台行为，把类型、注册、链接、生命周期与文件归属逐项推导到具体代码。

```text
锁定源码 / API 声明 / 工程模板
        → 目标 cfg、类型、FFI、链接与状态推演
        → 平台适配、Swift 插件、核心旅程与尽力后台
        → 阶段性手动 GitHub Actions 构建、链接与设备架构打包
        → 实验性 .app.zip / .unsigned.ipa，用户自行签名
```

实现按模块依赖和源码审计结果推进；Apple 构建集中在插件接入 G1 与首版集成/打包 G2 两个验收点，具体安排见 07/08。研究中每个结论都附源码位置或 API 来源，每个待办都写明缺失信息、获取入口和影响的具体路径。环境与检查结果集中记录在 [00](./00-研究契约与证据账本.md)。

### 本次修订保留与纠正的内容

| 主题 | 当前处理 |
|---|---|
| 插件命令 | 当前 42 条；核对 opener 源码后将本地文件预览改列 Swift 接入，分类 `R3 / S7 / L15 / X17` |
| 生命周期 | Swift producer、Rust subscribe 和 bootstrap 一起接通；保留 Android-only 订阅这一源码发现 |
| 尽力后台 | 恢复 D2/D15 的研发目标；实现任务提交、激活、进度、取消与前台回退，具体进度适配见 04 |
| 用户自签产物 | 恢复 D8；检查 device Mach-O、包结构、最终 Bundle ID 与 entitlement 配套，见 06 |
| 前端现状 | 保留 PermissionGate 已挂载、Router 仅 `/ → /chat`、overlay/page stack 承载业务页的修正 |
| 决策归属 | 旧 D1–D19 中的产品选择继续有效；本次撤回研究者自行加入的设备开发门禁和范围收缩 |

### 首个实验产物

按旧 D15 组织首个产物：

- iPhone/iPad 共用 Chat、Diary、Settings、SQLite 与手动 Sync；
- 原生 Files/PHPicker、security-scoped staging、大图/HEIC 处理与附件 CAS；
- safe area、键盘、返回、文本选择与当前窗口宽度响应；
- iOS 26+ 用户发起的生成尝试采用 continued-task 尽力续跑，其他情况采用前台常亮；
- 独立的 iOS 构建与打包路径，保留 Android arm64 正式链路。

沿用旧决策及 05 的功能范围：incoming Share Extension、系统通知/APNs、语音、相机、PhotoKit 保存、outgoing share、视频抽帧与完整设备工具留待后续。Root、APK 更新、通知监听等 Android 功能按 02 的能力映射处理。最低系统以 `15.0` 为工程候选，结合锁定依赖的 deployment target 要求确定；continued API 单独采用 availability 分层。

### 关键施工任务

1. 从锁文件逐依赖审查 Apple cfg、build script、原生源码与链接符号，形成 01 的依赖账本。
2. 建立 typed `PlatformCapabilities`，分离平台支持、实现状态、用户授权和即时可用性。
3. 把 `not(android)` 拆成 iOS adapter 与 host 开发分支，落实真实返回值和副作用。
4. 连接 `ios_path`、Swift Package、binding、`register_ios_plugin` 与 native Channel。
5. 接入生命周期、附件 data/cache/staging、键盘与返回策略，再完成尽力后台任务协调。
6. 实施阶段同步产品边界文档，建立 iOS 配置、命令授权和打包脚本；本次修订范围为本研究目录。

### 当前 42 条命令结论

| 类别 | 数量 | iOS 动作 |
|---|---:|---|
| `R` | 3 | 复用 Rust/跨平台实现，明确 Apple container 路径与实际副作用 |
| `S` | 7 | 需要 Swift，以公开 Apple API 实现接近语义 |
| `L` | 15 | 必须改 DTO、生命周期或交互承诺后才能实现 |
| `X` | 17 | Android 专属或无安全等价；iOS capability 不授权、UI 不展示 |
| **合计** | **42** | 文件名中的“41”仅为历史链接兼容，正文以当前矩阵为准 |

详见 [02-平台能力与41条命令兼容矩阵.md](./02-平台能力与41条命令兼容矩阵.md)。分类描述迁移方式，产品范围由 09 的决策表确定。

### 阅读与完成标准

实现结论使用“源码/声明 → 条件推演 → 改动位置 → 检查方法”的结构。日常逐条记录入口覆盖、分支条件、缺陷和修复回扫；阶段验收记录 GitHub Actions 的输入、诊断与产物。完成度以具体路径和问题是否闭环衡量，性能沿用 D16 的静态预算范围。

## 文档导航

| 文档 | 当前职责 |
|---|---|
| [00-研究契约与证据账本.md](./00-研究契约与证据账本.md) | 当前基线、源码推演方法、检查记录与来源 |
| [01-架构现状与跨平台改造边界.md](./01-架构现状与跨平台改造边界.md) | Rust/Tauri 可复用面、平台 owner 与 cfg 边界 |
| [02-平台能力与41条命令兼容矩阵.md](./02-平台能力与41条命令兼容矩阵.md) | 当前 42 条命令、消费者、隐藏原生面与 ACL |
| [03-WebKit与iPhone-iPad交互适配.md](./03-WebKit与iPhone-iPad交互适配.md) | WKWebView、键盘、安全区、手势、可访问性 |
| [04-生命周期后台网络与同步策略.md](./04-生命周期后台网络与同步策略.md) | 生命周期、尽力后台、Chat/Sync、LAN/ATS |
| [05-文件媒体分享通知与设备能力.md](./05-文件媒体分享通知与设备能力.md) | staging、媒体、分享、通知与设备事实 |
| [06-安全隐私签名与App-Store发布.md](./06-安全隐私签名与App-Store发布.md) | capability、隐私清单、用户自签产物与打包 |
| [07-CI测试矩阵与无设备验证边界.md](./07-CI测试矩阵与无设备验证边界.md) | 日常源码审计、缺陷闭环与阶段性 GitHub Actions 验收 |
| [08-分期实施路线图与验收门禁.md](./08-分期实施路线图与验收门禁.md) | 实施顺序、模块依赖与完成条件 |
| [09-Magi综合裁决与待决策清单.md](./09-Magi综合裁决与待决策清单.md) | 三方审查、D1–D19 决策沿革与具体待办 |
