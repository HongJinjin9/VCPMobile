# 09. Magi 综合审查与产品决定

> 修订日期：2026-10-07。产品输入沿用 Git HEAD 旧稿记录的 2026-08-13 D1–D19，并落实本次用户确认的源码驱动开发方式。

## 2026-10-07 联合裁决

以 Tauri 原生 iPhone/iPad 客户端为目标，复用 Vue/Rust 核心，实施 Swift adapter、原生附件与 iOS 26+ 尽力后台，最终生成供用户自行签名的实验性产物。开发按依赖源码、编译规则和状态推演持续推进，Apple 构建仅在阶段验收时通过 GitHub Actions 手动执行。

## 三贤者独立意见

### Melchior：逻辑与系统

本次三方审查分别读取当前生产代码、锁定依赖和旧稿决定；以下结论已合入 01–08。

支持继续的资产：

- 中央 IPC offload；
- Rust 单一领域 owner；
- Chat UUID/CancellationToken/ABA lease；
- Sync generation/cancel/join/child drain；
- SQLite、附件 CAS、前台 Rust 网络。

明确的实施工作：

- 拆 iOS/host cfg，按实际 adapter 返回状态；
- 同时接通 Swift producer、插件订阅与 bootstrap 的 native Channel；
- 使用 Tauri 随包 Swift API，核对 ObjC selector、IPC 队列与 UIKit 主队列；
- 让桥接任务接收原生最终响应，业务取消按 generation 归约；
- 为 Chat 加 cancellation cause、settle receipt 与 task 绑定；
- iOS 目录映射和大文件/像素缓冲预算；
- 按真实 feature 图审计 SQLite、zstd、ring，结论见 01。

系统结论：Swift 持有 Apple 平台资源，Rust 继续拥有 Chat/Sync/DB 和终态。FFI、线程、回调与原生库的输入已能由源码具体分析，下一步是逐路径实现。

### Balthasar：直觉与交互

- 保留高密度线性布局、灰度、语义层级和现有 overlay owner；
- PermissionGate 的检查步骤、异常文案、组件挂载一起按平台选择；
- iOS 返回复用 modal/page/session 链，根动作保持应用；
- Insets 明确来源和单位，扣除 WebKit 已处理的视口缩小量；
- iPad regular width 用同一状态 owner 的 dialog/popover；
- 44×44 CSS px 命中区通过 hit slop 达成，编辑控件至少 16 CSS px；
- 文本选择优先于自定义 ancestor longpress；
- Updater 同时收口初始化、自动/手动检查和安装；
- 附件三条导入链汇入 CAS 登记，原生 Files/PHPicker/ImageIO 保持 P0；
- 大上传补 abort、generation 和清理，图片先读元数据再按预算解码。

交互结论：适配以明确坐标、状态和资源归属完成；iPhone/iPad 的窗口与交互输入逐条纳入源码路径审计。历史已延期的相机、语音、通知等仍按原范围处理。

### Casper：务实与交付

交付路径：

1. 目标依赖审计与平台契约；
2. Swift/Channel/生命周期；
3. 核心业务与原生附件；
4. 尽力后台和前台回退；
5. 构建脚本、device bundle 与用户签名输入；
6. 阶段性 GitHub Actions 验收与实验产物打包。

本次恢复的关键决定：

- D2/D15：continued task 属于首产物实现目标；
- D8：设备架构 `.app.zip` 与结构检查后的 `.unsigned.ipa` 供用户自行签名；
- D13：用户可以改 Bundle ID，plist/task identifier/entitlement 配套处理；
- D14/D16：日常源码审计与静态内存预算贯穿开发，Apple 构建集中在 GitHub Actions 阶段验收执行；
- D18：HTML 子路径可先联调，原生文件/图片仍属于 P0。

交付结论：构建中间件与用户设备架构产物各有明确结构。06 已从签名工具源码追到 unsigned bundle 的实际处理路径；工程应据此准备输入与说明，07/08 规定源码闭环及 G1/G2 验收节奏。

## 当前决策账本

| ID | 既定产品选择 | 当前实施解释 |
|---|---|---|
| D1 | Tauri 原生 iPhone/iPad | 同一 Vue/Rust + Swift adapter |
| D2 | iOS 26+ 尽力后台，其他情况前台常亮 | request/activate/progress/expiration/terminal 全链，服务端协议保持原范围 |
| D3 | 接受按平台语义分类迁移 | 当前 42 条；核对本地预览接入后分类为 R3/S7/L15/X17，依据见 02 |
| D4 | minimum 在实施中确定，新 API 分层 | 15.0 是工程候选；逐依赖/API 核对后显式设置 |
| D5 | iPhone+iPad、单 Scene、当前窗口宽度响应 | 复用组件树，按框架要求接 Scene 生命周期 |
| D6 | 不可用入口隐藏或说明原因，命令返回真实结果 | capability、ACL、UI 与 Rust owner 同步 |
| D7 | 安全默认 + 用户显式受信 LAN | LAN 属于首期，细化 Rust/WebKit transport 和拒绝恢复 |
| D8 | Android Release 附属实验性 unsigned 产物，用户自签 | 06 的设备 `.app.zip` / 条件性 `.unsigned.ipa`；应用内更新归 Android |
| D9 | incoming share 延期 | 保留现有 ticket/session 资产供后续使用 |
| D10 | 系统通知/APNs 延期 | 首期 App 内通知中心/Toast |
| D11 | 高密度线性 UI、语义层级、iPhone/iPad 基础可访问性 | 命中区、输入字号、焦点和返回，按实际 DOM/样式/事件路径审计 |
| D12 | Swift adapter，单 Rust 业务 owner | 生命周期、附件、任务通过现有 IPC/Channel 连接 |
| D13 | CI 候选 ID `com.vcp.avatar`，用户可改写 | 最终 ID、plist task 前缀和 entitlement 配套 |
| D14 | 日常源码审计，Apple 构建仅用阶段性 GitHub Actions；项目 iOS 实机测试、正式签名及付费 Team 为范围外 | 2026-10-07 用户进一步固定验收方式；G1 接入、G2 集成/打包，手动触发，见 07/08 |
| D15 | 首产物为核心业务 + 文档/文本/图片 + 尽力后台 | 前台核心作为中间里程碑，完整范围按 08 交付 |
| D16 | 采用静态正确性与硬上限，设备性能专项为范围外 | 审查像素、缓冲、副本和并发预算 |
| D17 | 语音延期 | 保留范围决定；旧稿“Android 已不可用”修正为 MIME/扩展名契约问题 |
| D18 | 原生获取/staging/大图，Rust 解析与 CAS，附件 P0 | Files/PHPicker/security scope/ImageIO 与三条导入链 |
| D19 | 真实 token/字符/字节/chunk/terminal，未知总量表达为未知 | 领域计量与系统 Progress 分层，具体适配问题见 04 |

相机、PhotoKit 保存、outgoing share、视频抽帧、完整遥测/Distributed 延期来自旧 02/05 的功能范围，随本表继续保留。

### 2026-10-07 用户追加决定：开发与验收节奏

D14 进一步明确为长期工作方式：项目现在及后续均不建设 iOS 实机测试体系；开发在 Windows 通过生产源码、锁定依赖、接口声明和编译规则逐条查找并修复缺陷。GitHub Actions 是唯一 Apple 构建入口，只在阶段性验收手动执行，集中处理编译、链接与产物诊断。07/08 据此撤下固定 Simulator 旅程及社区设备验收项，默认采用 device archive；按需 Simulator 诊断同样限定在 Actions 阶段验收内。

### 对前次 N 表的处理

N3/N5/N6 将 D2/D15 改成前台限定和真机研发门禁；N7/N8 改写了 D8/D14；这些结论在本次修订中撤回。N4 的 15.0、N16 的具体 Xcode 版本恢复为工程选型。N9 的命令变化及 N10–N12 的能力、cfg、Channel 发现保留。历史 N 表退出施工依据，后续引用统一使用本表 D 编号。

## 具体工程待办

| 问题 | 获取信息/实施动作 | 影响范围 |
|---|---|---|
| generated tree 归属 | 对照锁定 CLI 模板，列出生成文件与需要维护的配置 | 工程生成脚本 |
| minimum/Xcode/SDK | 汇总依赖 deployment target，查看 runner 库存并固定输入 | 构建及 availability |
| 连字符插件命名 | 核对 Package product、导出符号、Rust binding | Swift 链接 |
| 未知总量进度 | 读取 Progress/BGContinuedProcessingTask 声明，完成映射与 system end 分支 | continued-task progress adapter |
| Keychain 迁移 | 盘点 secrets 消费、备份、登出和迁移路径 | 既有 P1 安全改进 |
| Scene 接入 | 沿 Tauri/tao delegate/manifest 核对所选 SDK | 生命周期与启动 |
| 自签 Bundle ID | 定义 plist/entitlement/task identifier 同步改写与检查 | 用户产物 |

每个问题只影响表中对应路径；其他独立任务照 08 推进。

## 决定、事实与建议的记录方式

| 类型 | 例子 | 更新依据 |
|---|---|---|
| 用户决定 | D8 自签产物、D18 附件 P0 | 用户对目标/范围的选择 |
| 源码事实 | 当前命令 42 条、Channel 的 cfg、SQLite feature 图 | 当前生产代码与锁定依赖 |
| 工程建议 | minimum 候选、runner 组合、模板管理方式 | 具体条件分析与实现取舍 |
| 执行结果 | 本地检查、GitHub Actions 构建诊断与产物结果 | 对应输入与实际记录 |

技术研究可以指出某项决定遇到的具体 API/实现问题，并提出可选方案；工作条件记录在 00，任务按源码与接口依赖组织，阶段验收按 07/08 集中执行。

## 变更规则

改变产品范围时记录：

- 触发证据和日期；
- 影响的代码 owner/章节；
- 用户选择及对应技术依据；
- Android 回归范围；
- 受影响的首产物交付物。

源码修正和执行诊断归入对应章节，产品决定留在本表。研究段落以具体发现、推导、改动位置和下一项工作结束。
