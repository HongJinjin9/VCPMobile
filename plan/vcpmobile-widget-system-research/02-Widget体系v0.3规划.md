# VCPMobile Widget 体系 v0.3 规划

> 版本：v0.3（定稿，替代 v0.2 草案）
> 定位：widget 是 AI 从零写、可修改、有生命的轻量页面，介于 HTML 预览块（一次性写成、无法修改）与桌面端 Loom 应用（高成熟度复用）之间。
> 形态来源：移植 VCPChat 桌面端 `DESKTOP_PUSH` 生产实现（`Desktopmodules/core/widgetManager.js`、`modules/renderer/desktopPushConsumer.js`），容器由 Shadow DOM 换为 sandbox iframe，持久化升级为全文件存储。
>
> 工程纪律：**本体系只关心两件事——竞态与内存泄漏。** 容器与隔离由 iframe 天然免费提供，不额外设防。

---

## 一、总览

```
AI 流式输出 WIDGET_PUSH 围栏
  → 消息流消费者逐 token 解析（100ms 节流）
    → sandbox iframe 实时 append，widget 当着用户的面长出来
      → finalize 执行内联脚本，widget 活了
        → 落盘 files/widgets/<id>/（全文件存储）
          → 侧边栏列表 / 桌面页格子 / 应用内悬浮球 随时点开
            → 跨轮编辑：replace 选择器替换 / 同 id 整版重写
```

查看入口：移动端没有多窗口，widget 不在对话外常驻可见；用户通过**侧边栏 widget 列表**或**应用内悬浮球**（贴边小球 → 点开面板）查看。流式出生过程中两者同样可点——流式查看需求成立，流式协议是核心体验，不可裁。

## 二、流式协议（WIDGET_PUSH）

移植桌面端 `DESKTOP_PUSH`，语义三合一，全部由首行声明区分：

### 2.1 创建（无 id 声明）

```
<<<[WIDGET_PUSH]>>>
<div id="clock" style="...">加载中…</div>
<script>
  setInterval(function(){ /* ... */ }, 1000);
</script>
<<<[WIDGET_PUSH_END]>>>
```

- 消费者为每个新围栏分配 widgetId，流式 append 累积内容；
- 前缀校验（VALID_PREFIXES：`<div`/`<section`/`<article`/`<main`/`<canvas`/`<svg`/`<style`/`id:`/`target:`/`<!--`），30 字符内不合法即丢弃该块；
- `END` 到达后 finalize：执行内联脚本、注册存储、进入活跃态。

### 2.2 局部编辑（target/replace 声明）

```
<<<[WIDGET_PUSH]>>>
target:「始」#clock .minute「末」
replace:「始」<span class="minute">42</span>「末」
<<<[WIDGET_PUSH_END]>>>
```

落点：`iframe` 内 `querySelector(target).innerHTML = replace`。这就是全部编辑语义，一字不加。局部编辑不升版本号，但同步落盘到当前版本文件（见 §四）。

### 2.3 整版重写（id 声明）

```
<<<[WIDGET_PUSH]>>>
id:「始」pomodoro-red「末」
（完整新 HTML）
<<<[WIDGET_PUSH_END]>>>
```

落盘为新版本（v1 → v2），活实例热重启：先经桥收账 state → 换 srcdoc → 启动时灌回 state。改崩了用户长按回滚上一版。

## 三、容器与桥

### 3.1 容器

`sandbox="allow-scripts"` + srcdoc 的 iframe。选它的理由就两条，都是工程理由：

- **资源回收免费**：iframe 销毁即定时器、监听器、DOM 全清，不需要桌面端那套手工记账；
- **隔离免费**：opaque origin 下 widget 脚本触不到主应用 IPC 与存储。

### 3.2 宿主注入桥（bootstrap，postMessage 协议）

iframe 加载时宿主注入一段 bootstrap，向 widget 暴露：

```js
vcp.state.load()            // → Promise<json>，启动时恢复 state
vcp.state.save(obj)         // 持久化运行时状态（高频，宿主侧串行写队列）
vcp.fetch('/admin_api/…')   // VCP 后端数据代理（参照桌面端 vcpAPI.fetch）
vcp.prompt(text)            // 对话意图回传（widget → 发一条用户消息）
vcp.capabilities            // 已授权能力位（震动/定位等，见 §六）
```

另有 view 回环：宿主 postMessage 一段查询（`document.documentElement.outerHTML` / `document.body.innerText`），bootstrap 执行后回传——AI 的 `Widget.view` 工具由此实现，供 AI 跨轮回读"widget 现在长什么样"。

### 3.3 CDN 透传

`<script src="https://cdn…/three.min.js">` 在 iframe 内天然工作，不做任何处理。表达力上限 = 整个 Web。

## 四、存储（全文件 + 物化索引）

```
files/widgets/pomodoro-red/
├── manifest.json    # id、名称、当前版本号、来源对话、capabilities、创建/活跃时间
├── versions/        # v1.html / v2.html …（整版重写才新增版本）
│   └── v2.html
├── current.html     # 当前版本内容（replace 局部编辑直接写这里）
├── state.json       # 运行时状态（高频写，串行队列）
└── snapshot.png     # 冻结态缩略图（冻结时覆盖）
```

- `index.json` 物化索引汇总全部 manifest，启动只读索引，损坏时全量重建；
- 版本回滚 = 把旧版本复制为 current.html；
- 分享导出 = 目录打 zip 为 `.vcpw`，导入即解压入库（配合 Android 文件关联 + `RunEvent::Opened` 做系统入口，Tauri 2.11 已支持）。

## 五、生命周期与承载面

三态模型：

```
休眠（dormant）   ←→   冻结（frozen）   ←→   活跃（live）
只有文件              显示 snapshot+红点      真 iframe 运行
```

- 休眠 → 冻结：侧边栏/桌面页滚入视口预载；
- 冻结 → 活跃：停留即激活，iframe 起 srcdoc、灌 state；
- 活跃 → 冻结：滑出视口 → 强制收账 state → 截图 → 销毁 iframe（资源全清）；
- **活跃硬上限 8**，超限冻结最久未用者；引了重型 CDN 库的 widget（manifest 标记 `heavy: true`）单独上限 3。

承载面三处，全部是同一个 iframe 组件换容器：

1. **对话内**：widget 出生地与最小展示形态；
2. **侧边栏列表 + 桌面页格子**：管理与常驻，冻结态显示快照，点开即活；
3. **应用内悬浮球**：贴边小球（单击展开当前活跃 widget、长按拖动），纯 Vue overlay 实现。系统级悬浮窗不做。

## 六、capabilities 授权

- manifest 声明所需能力：`haptics / location / sensors / share …`；
- 用户长按格子逐项授权；授权 = 桥开放对应命名空间；
- 网络不做能力项，默认可用（`vcp.fetch` 之外的直连 fetch 也不拦）。

## 七、竞态与内存纪律（本体系唯一的防御章节）

**竞态：**

1. 流式消费者状态按 messageId 隔离；消息撤销/中断 → 立即 `cleanup`（停节流定时器、弃 buffer），照桌面端 `cleanupMessage/revoked` 模式；
2. 同一 widget 的一切 iframe 操作（append/replace/热重启/收账）进**单队列串行执行**，replace 与流式 append 不允许交错；
3. 整版重写与用户对旧版的并发交互：版本号乐观判重，热重启期间输入事件丢弃；
4. state 写盘串行队列；`beforeunload` 不可靠，宿主侧**周期性收账 + 冻结/销毁时强制收账**双保险。

**内存：**

1. iframe 销毁即 widget 侧全清；宿主侧必须同步解除 postMessage 回调与 Map 引用（两边都清才算清）；
2. 活跃上限与 heavy 上限（§五）；
3. 侧边栏与桌面页列表只渲快照，不跑活实例；
4. 进程被回收/重载兜底：任何时候冷启动自休眠态恢复，state 因双保险收账不丢。

**已知代价（摆明接受）：** widget 脚本与主页面同线程，AI 写出死循环 = App 卡死重载。肇事 widget 打事故标记，默认不再自动激活，待 AI 下轮修复后解禁。不做事前扫描，不做看门狗。

## 八、AI 侧提示词约定

````
## Widget 能力

你可以通过 <<<[WIDGET_PUSH]>>> 语法在对话中创建活的 widget，用户可在侧边栏/悬浮球随时查看。

- 创建：直接输出 HTML（可含 <style>/<script>，支持 CDN 脚本）
- 局部修改：target:「始」选择器「末」+ replace:「始」新内容「末」
- 整版重写：首行 id:「始」<widgetId>「末」+ 完整新 HTML

widget 内可用 API：vcp.state.load()/save()、vcp.fetch()、vcp.prompt()。
需要持久化的数据随时 vcp.state.save()；启动时先 vcp.state.load()。
````

管理类走 VCP 工具（非围栏）：`Widget.list` / `Widget.view` / `Widget.remove`。

## 九、里程碑

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1 | WIDGET_PUSH 消费者 + iframe 容器 + state 桥 + 侧边栏列表 | 对话内流式出生，侧边栏可看 |
| M2 | 全文件存储 + 索引 + replace/rewrite + `Widget.view` | widget 有家了，AI 能改能看 |
| M3 | 桌面页格子（三态 + 上限）+ 应用内悬浮球 | 常驻与速达 |
| M4 | 版本回滚 UI、capabilities 授权 UI、`.vcpw` 导出导入 | 闭环 |
| M5 | （可选后置）系统主屏 AppWidget 位图法 | 站岗 |

## 十、与 v0.2 的差异记录

- 容器：iframe 契约（sandbox token 表、清洗、禁区）整套删除 → 保留 `allow-scripts` 单 token，理由改为工程性（资源回收/隔离免费）；
- 编辑：版本化整版替换 → 增加 replace 选择器替换为主力编辑语义（移植桌面端生产协议）；
- 出生：finalize 后静态渲染 → 流式逐 token 出生；
- 悬浮：系统悬浮窗（TYPE_APPLICATION_OVERLAY）→ 应用内悬浮球；
- 看门狗：冻结看门狗 → 诚实的事故标记条款（§七）；
- 不变：全文件存储、三态模型、活跃上限、capabilities 逐项授权。
