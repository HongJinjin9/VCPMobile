# 03. WebKit 与 iPhone/iPad 交互适配

> 2026-10-07 修订：保留现有组件与状态所有者，逐入口适配 WKWebView 和 iPhone/iPad 交互。

## 2026-10-07 当前前端结论

现有前端已具备 `viewport-fit=cover`、四边 safe-area CSS、按当前窗口宽度的单/双栏布局、语义化 overlay 层级和强渲染 fallback。适配重点是平台启动步骤、Insets 数据来源、返回与手势、输入布局和 WebKit 特性。

### 已变化的生产事实

- `PermissionGate` 在 `App.vue` 的 `PERMISSIONS` 状态挂载；`appLifecycle.ts` 执行 Android 权限检查，异常路径也会产生 Android 后台权限警告。适配同时覆盖检查步骤、警告文案与组件挂载。
- 当前 Router 只有 `/` 重定向到 `/chat`；Settings、Agent、Task 等主要由 overlay/page stack 承载。
- `WebGLFluidBackground` 已处理关闭停帧、context lost/restored 和 DPR 限制；仍缺 app background/visibility 与 `prefers-reduced-motion` 收口。
- `useAutoUpdate` 在所有平台初始化，`UpdatePrompt` 无条件挂载；iOS 会查询 Android Release/APK。
- 语音 composable、相机/相册/文件按钮、Root/Distributed/CLI 入口仍按共同组件树展示；需要按 09 的范围选择呈现。
- 现有少量 `navigator.userAgent.includes("android")` 区分 Android/browser 路径；新增 capability 后由统一平台信息驱动。

### P0：平台化启动与入口

新增一个进程级 capability owner，至少控制：

- Android PermissionGate 与 Android 后台权限文案；
- updater 检查、设置入口、Prompt 与 APK download；
- Root、CLI/PTY、设备遥测、Distributed tools；
- 语音、相机、保存相册、系统通知、incoming/outgoing share；
- 文件 picker/export/open、剪贴板 fallback；
- iOS 根返回语义。

所有 Feature 继续使用同一组件树，按 capability 和当前窗口宽度改变呈现。Updater 的接入点要覆盖 `useAutoUpdate` 初始化、READY 后检查、设置页手动入口、Prompt 以及 Rust download/install owner；只修改弹窗可见性会留下实际网络请求。

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
- native 快照需增加 source、sequence、generation、scene resize 与失效处理；
- Chat 使用局部 `--keyboard-offset`，其他编辑页消费方式不一致；
- `themes.css` 顶部 safe area 为 `max(env(...), 24px)`，iOS 横屏/零顶部 inset 时需由平台策略去掉这项 Android 占位。

目标契约：

1. safe area 默认继续由 CSS `env(safe-area-inset-*)` 提供；
2. Insets 使用一个数据源选择 owner，字段包含 `source/unit/sequence/visible/overlapCssPx`，每次输出说明坐标空间；
3. 先算 WebKit 已经缩小的可见区域，再算业务底部还需补偿的遮挡量；用 `visualViewport.height/offsetTop` 或 Swift frame 转到同一 CSS 坐标，避免重复抬升；
4. Android physical px 沿用 DPR 换算；UIKit points 根据 WebView 坐标和缩放转换，旋转、Scene resize、来源释放后重新计算；
5. Chat、FullScreenEditor、Task、Agent、Mail、Forum、Diary 的输入消费方逐个核对 padding、safe bottom 和 keyboard offset；iOS 范围外的 CLI 沿用 Android 路径。

每个输入面推演显示/隐藏、切焦点、浮动键盘、横竖屏和窗口缩放。用已定义坐标量编写几何用例，逐项追踪到 Swift/JS 的单位换算、CSS 消费和剩余遮挡计算，记录边界输入与推导结果。

### P0：返回、手势与选择

- `App.vue` 依次关闭顶层 modal、清当前会话，根部才执行双击 `move_task_to_back` 及失败后的 window.close；iOS 复用前两级并将根动作设为保持应用。
- iOS 根状态只允许关闭顶层 overlay/page 或清空当前会话；到根后保持 App。
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

- deployment target 确定后，给 Vite 明确对应 Safari 语法目标；
- 逐项核对实际使用的 CSS/API availability，区分构建语法转换、运行 API 与样式 fallback；
- fixture 覆盖 morphdom/DOM engine、KaTeX、Mermaid、raw HTML sandbox、`iframe.srcdoc`、Canvas 导出、长会话 `content-visibility`、asset protocol、字体和剪贴板；
- WebGL 已有 active 停帧、context lost/restored 与 DPR 1.5 上限，补生命周期 visibility/reduced-motion 的停启路径；
- Playwright 和后续 WKWebView 使用同一批输入，分别记录引擎与实际结果。

### 实施完成条件

每个布局改动有明确输入和唯一输出 owner；全部消费者使用一致单位；每个弹层能说明焦点进入/退出、返回消费与层级；每个强渲染特性保留原有结构和交互。把响应宽度、Insets 数值、输入文本和预期几何关系写成可复查用例，沿实际 DOM/样式/事件路径审计并修复差异；阶段性检查统一按 07 执行。
