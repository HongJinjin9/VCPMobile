# 03. WebKit 与 iPhone/iPad 交互适配

> 2026-10-09 修订：对照 Phase 3 基线 `8207ec70` 及当前工作树，保留现有组件与状态所有者，按最新功能审批逐入口适配。未取得 Apple 构建或 iOS 运行结果。

## 当前前端与待适配交互

现有前端已具备 `viewport-fit=cover`、四边 safe-area CSS、按当前窗口宽度的单/双栏布局、语义化 overlay 层级和强渲染 fallback。适配重点是平台启动步骤、Insets 数据来源、返回与手势、输入布局和 WebKit 特性。

### 已变化的生产事实

- `appLifecycle.ts` 仅在 Android 启动时执行原通知/电池/通知监听检查。共同 `PermissionGate` 已增加 iOS 本 App 通知可选项目，首次未询问可开启或继续；拒绝/查询失败不阻断聊天。通知中心提供权限/设置入口并在返回前台刷新，不持久镜像 OS 授权。
- 当前 Router 只有 `/` 重定向到 `/chat`；Settings、Agent、Task 等主要由 overlay/page stack 承载。
- `WebGLFluidBackground` 已处理关闭停帧、context lost/restored 和 DPR 限制；仍缺 app background/visibility 与 `prefers-reduced-motion` 收口。
- 版本更新入口已保留，iOS 点击说明 App 外自签；`useAutoUpdate` 的初始化/延时检查和 `UpdatePrompt` 仍限 Android，不在 iOS 请求 APK。
- 语音按钮在 iOS 保留，触摸开始或独立点击给出未开发说明；不启动录音计时/麦克风，触摸结束不切入语音模式。Android 语音行为保留。
- Distributed iOS 页面已接真实连接、断开、目录/授权与样本读取；通知工具启用处理真实系统授权，Root/CLI 保留说明。配置读取/保存及返回值沿本次操作归约，单项设备数据缺失正常展示；源码接通不等于 Apple 运行通过。
- 文件/图片聊天入口仍有 HTML 子路径，头像和重型附件点击有具体说明；相机、相册保存、原生打开等尚待各自 adapter。最新审批已纳入这些原生能力，不能继续列为永久隐藏或旧范围延期。
- `src/core/utils/platform.ts` 通过 `plugin-os` 同步提供 `isAndroid/isIOS`，不依赖 UA、能力查询或启动重试；旧 `PlatformCapabilities` 和前端平台 Store 已删除。

### 平台入口已简化，后续按真实功能接入

沿现有组件和状态 owner 完成后续工作：

- 共同权限引导：按平台真实项目展示、请求和刷新；iOS 无 OEM 自启动、通知访问或电池豁免项目，不以假授权填满 Android 步骤；
- 更新/Root/语音：保留已接入的说明入口与自动路径隔离，不因显示按钮而初始化原生执行；
- 缓存：共享维护页已用运行时文案区分 WebView/WebKit，iOS 当前显示尚未接入；真正清理后才报告成功，预渲染维护继续由原 owner 处理；
- 本 App 系统通知、网络/设备与 Distributed 的 P3 源码链已接通，继续回扫权限拒绝、取消及实际结果；incoming/outgoing share、相机、相册仍归 P4，系统通知不自动扩展为完整 APNs；
- Files/PHPicker/export/open：原生附件仍为 P0，HTML 输入不是完成依据；iPad 原生展示需正确锚点；
- lifecycle/网络恢复：保留 iOS 首次真实 active、native sequence/epoch 与同一恢复 owner；旧能力字段不能替代这些实时状态。

所有 Feature 继续使用同一组件树，简单平台差异直接使用 `isAndroid/isIOS`，布局只按当前窗口宽度。每次改动同时追踪点击、自动启动、监听、恢复和导入配置，结果由原 owner 告知；不建立全局能力状态机、按钮策略框架或平台页面副本。U1 关于页集中功能说明仍是未批准建议，不作为本轮必做页面。

### P0：safe area 与键盘契约

当前 `useKeyboardInsets.ts` 的链路是：

```text
Android vcp-keyboard-inset
  -> Virtual Keyboard API
  -> focus + scrollHeight - innerHeight 估算
```

需要处理的源码条件：

- 当前链路使用 native、Virtual Keyboard 与高度差估算，需要增加 `visualViewport` 数据源；
- 任意 native snapshot 会把 `nativeSnapshotSeen` 永久置真，并用 inline px 覆盖 CSS `env()`；
- 原生数值统一除以 DPR；若 Swift 上报 UIKit points，会被二次缩小；
- iOS 来源接入时核对旋转/Scene resize、迟到快照和来源释放；仅在真实多来源/乱序需求出现时补必要身份和去重字段，不建立每组件 Insets 状态；
- Chat 使用局部 `--keyboard-offset`，其他编辑页消费方式不一致；
- `themes.css` 顶部 safe area 为 `max(env(...), 24px)`，iOS 横屏/零顶部 inset 时需在现有归一化入口去掉这项 Android 占位。

目标契约：

1. safe area 默认继续由 CSS `env(safe-area-inset-*)` 提供；
2. Insets 继续使用一个归一化 owner，明确单位、可见状态和实际遮挡；字段按生产者/消费者需要确定，不强制引入整套新的平台协议；
3. 先算 WebKit 已经缩小的可见区域，再算业务底部还需补偿的遮挡量；用 `visualViewport.height/offsetTop` 或 Swift frame 转到同一 CSS 坐标，避免重复抬升；
4. Android physical px 沿用 DPR 换算；UIKit points 根据 WebView 坐标和缩放转换，旋转、Scene resize、来源释放后重新计算；
5. Chat、FullScreenEditor、Task、Agent、Mail、Forum、Diary 的输入消费方逐个核对 padding、safe bottom 和 keyboard offset；iOS 范围外的 CLI 沿用 Android 路径。

每个输入面推演显示/隐藏、切焦点、浮动键盘、横竖屏和窗口缩放。用已定义坐标量编写几何用例，逐项追踪到 Swift/JS 的单位换算、CSS 消费和剩余遮挡计算，记录边界输入与推导结果。

### P0：返回、手势与选择

- `App.vue` 当前已经依次关闭顶层 modal、清当前会话；只有 Android 在根部执行双击 `move_task_to_back` 及原失败 fallback。iOS 到根保持 App，这不是尚待实现的任务。
- 后续手势改动继续复用上述返回链，不再为 iOS 建立另一份页面状态。
- `useModalHistory` 在模块求值时安装 popstate，App 在 router ready 后补 root dummy；沿现有 owner 对 UI close、popstate、拒绝关闭推演一次消费与恢复。
- `useSidebarSwipe` 已避让滚动、input/textarea 和 `.no-swipe`；在这些规则上增加边缘起点策略。左/右布局阈值分别为 1024/1280 CSS px，继续按当前窗口宽度工作。
- ancestor longpress/contextmenu 会与 iOS 文本选择、Copy/Lookup/Translate 竞争；可选择内容必须让原生选择优先。

### P0：可访问性

当前 `index.html` 设置固定缩放限制，全局还有 `touch-action: pan-x pan-y`；主输入 `InputEnhancer` 字号为 15px。实施任务：

- 统一 viewport 与 touch-action 的缩放策略；
- iOS input/textarea 使用至少 16 CSS px，同步调整 mention 背板的字体、行高与换行；
- 小图标配透明 hit slop，目标命中范围 44×44 CSS px，保留高密度列表视觉；
- BottomSheet/Prompt/Confirm/ModelSelector 补 dialog、焦点进入/恢复和 background inert；
- iPad regular width 采用同一 owner 的受限宽度 dialog/popover；后续 outgoing share 接入时复用触发控件的 popover anchor；
- reduced motion 覆盖 WebGL、About 3D 与大面积转场。

### WebKit 构建与强渲染检查

`vite.config.ts` 当前仍只写 `chrome87`，Vitest 仍是 `happy-dom`。施工时：

- 按用户已确定的 iOS/iPadOS minimum 26.0 和实际依赖，给 Vite 核对对应 Safari 语法目标；本轮同步平台身份不需要两套前端产物；
- 逐项核对实际使用的 CSS/API availability，区分构建语法转换、运行 API 与样式 fallback；
- 针对改动中真实不确定的输入核对 morphdom/DOM engine、KaTeX、Mermaid、raw HTML sandbox、`iframe.srcdoc`、Canvas、`content-visibility`、asset protocol、字体和剪贴板；复用已有 fixture，不把研究结论机械复制成测试；
- WebGL 已有 active 停帧、context lost/restored 与 DPR 1.5 上限，补生命周期 visibility/reduced-motion 的停启路径；
- 当前不建设 Playwright/iOS 实机验证体系；日常以源码、必要的 host 行为检查及生成 JS/CSS 为证据，Apple 编译/链接仅通过手动 G1/G2，不能将 happy-dom 结果表述为 WKWebView 运行通过。

### 实施完成条件

每个布局改动有明确输入和唯一输出 owner；全部消费者使用一致单位；每个弹层能说明焦点进入/退出、返回消费与层级；每个强渲染特性保留原有结构和交互。把响应宽度、Insets 数值、输入文本和预期几何关系写成可复查用例，沿实际 DOM/样式/事件路径审计并修复差异；阶段性检查统一按 07 执行。
