# Phase 4：文件媒体、双向分享与 WebKit 交互

> 工作区状态：原生适配尚未实施。2026-10-09 按 [功能审批第四列](../phase-2/09-功能权限与提示审议表.md) 纳入拍照、相册保存、双向分享和 WebKit 缓存；已有 HTML 子路径与说明入口不是这些原生功能的完成证据。

## 输入

现有目录/导入 DTO 与 Phase 2 原生事件接入。授权 UI 复用 Phase 3 共同引导；系统提供的用户选择与资源范围按本次操作处理。可按实际依赖与 Phase 3 并行，不依赖已删除的能力查询。

## 既定范围

Files/PHPicker/security scope/staging/ImageIO/CAS、拍照、相册保存、图片发送转换、文件预览/导出、incoming/outgoing share、上传取消；WebKit 缓存、CSS、Insets、键盘、选择、弹层和窗口布局。

产品输入沿用 [D1–D19](../09-Magi综合裁决与待决策清单.md)，依赖顺序见 [总路线](../08-分期实施路线图与验收门禁.md)。本入口是工作区索引，不表示本阶段已实施。

## 获批任务与依赖

| 任务 | 入口与实施内容 | 依赖与完成条件 |
|---|---|---|
| P4-1 Files/PHPicker | 原生选择、security scope、临时 URL 复制与 staged 结果，汇入现有三条导入链的 CAS owner | 与共享目录和导入 identity 对齐；取消、provider 失败、超限、登记失败都释放本次资源；原生路径不能替代长期附件登记 |
| P4-2 拍照、相册保存与 ImageIO | 拍照获取、图片/头像处理、保存附件图与 Mermaid 图；ImageIO 接到既存 CAS 图片真正发送路径 | 读取/相机/相册写入分别申请真实权限；先元数据再按像素/副本/并发预算解码，返回真实 MIME、尺寸与路径；保留查看与复制，不把拒绝授权报成图片损坏 |
| P4-3 预览、导出与 outgoing share | 原生预览/外部打开、Files 导出目的地、系统分享面板；配置/邮件/日志使用原消费者 | 用户取消不报失败，不先制造无消费者副本；完成后按 owner 清理 staging，成功文案不再写死 Android Downloads；iPad 面板锚点和重复调用需明确 |
| P4-4 incoming share | 研究并接入原生分享接收及必要 Extension/容器交接，复用 App 的 operation/session/ticket 链 | 明确进程边界、文本/文件交接、冷启动/重开、去重及过期清理；所需 Bundle ID、entitlement 和用户自签条件交 Phase 6。获批不等于共享容器和扩展工程已经接通 |
| P4-5 WebKit 缓存与交互 | 真正 WebKit 缓存操作及准确范围说明；safe area、keyboard/visualViewport、选择/焦点/返回、iPad presentation | 不清业务数据库或伪用 Chromium 路径；统一坐标与单位，避免重复扣除视口；保留强消息渲染、文本选择与现有 overlay owner |

视频抽帧仍为未批准实施的保留项；语音保持未开发说明，不因拍照或分享接入自动扩大其范围。

## 启动时的第一项工作

先串起 HTML IPC、loopback、native staging 三条入口到 CAS，定义每份文件和像素缓冲的所有者/预算。

在本目录新增阶段子规划、逐路径任务、验证与交接记录。每条任务列出生产入口/owner、输入输出、异常/取消、资源释放、依赖、验证方法；以代码恢复现状，不从旧计划反推实现。

## 完成条件

路径 containment/hash/TTL/取消/清理闭合；双向分享的来源与目标、Extension 到主应用的数据所有权、实际系统权限与取消结果明确；iPhone/iPad 窗口输入逐分支审计；强渲染能力保持。新增用途声明、扩展与资源输入交 Phase 6 集成 G2，不用 HTML 导入或 UI 可点击宣称原生链完成。

只登记实际执行的结果和仍待处理的问题；Apple 构建集中在 G1/G2 手动 Actions。进入下一阶段依据具体依赖和问题归属，不因独立待办阻断其他工作。
