# VCP Mobile 图标更新指南

> 本文档说明 VCP Mobile 的多平台图标系统结构及正确的更新流程。

---

## 1. 系统架构

本项目采用**复合分层图标系统**，不同平台使用不同的图标策略：

| 平台 | 策略 | 关键文件 |
|------|------|----------|
| **Android** | 分层图标（Background + Foreground） | `icons/android-background.svg` + `icons/android-foreground.svg` |
| **iOS / macOS / Windows / Linux** | 单一图标源 | `icons/icon.svg` |
| **Web Preloader** | 前端直接引用 | `public/vcpmobile.svg` |
| **Favicon** | 前端直接引用 | `public/vcpmobile.svg` |

所有 Tauri 平台图标的生成入口是 **`icon-manifest.json`**，由 `pnpm tauri icon` 命令驱动。

---

## 2. 文件清单与作用

### 2.1 源文件（手动维护）

```
src-tauri/
├── icon-manifest.json              # 图标生成配置入口
├── icons/
│   ├── icon.svg                    # 默认源图标（所有非 Android 平台）
│   ├── android-background.svg      # Android 背景层（纯色/图案）
│   └── android-foreground.svg      # Android 前景层（Logo 主体，带安全区变换）
```

### 2.2 生成文件（自动产出，勿手动编辑）

```
src-tauri/
├── icons/
│   ├── icon.png                    # 由 icon.svg 生成的默认 PNG
│   ├── icon.ico                    # Windows 图标
│   ├── icon.icns                   # macOS 图标
│   ├── 32x32.png / 64x64.png / ... # 通用尺寸
│   ├── Square*.png                 # UWP / Microsoft Store 尺寸
│   └── ios/                        # iOS AppIcon 全尺寸
├── gen/android/app/src/main/res/
│   └── mipmap-*/                   # Android 原生 mipmap 资源
│       ├── ic_launcher.png
│       ├── ic_launcher_round.png
│       ├── ic_launcher_foreground.png
│       └── ic_launcher_background.png
```

### 2.3 前端引用文件

```
public/
└── vcpmobile.svg                   # 前端 preloader + favicon 源

index.html
└── <img src="/vcpmobile.svg">      # WebView 加载前的 preloader 图标
```

---

## 3. 关键配置说明

### `icon-manifest.json`

```json
{
  "default": "icons/icon.svg",
  "android_bg": "icons/android-background.svg",
  "android_fg": "icons/android-foreground.svg",
  "android_fg_scale": 100
}
```

| 字段 | 说明 |
|------|------|
| `default` | 所有非 Android 平台的源图标。支持 SVG 或 PNG。路径相对于 manifest 文件。 |
| `android_bg` | Android 背景层。必须是 SVG。 |
| `android_fg` | Android 前景层。必须是 SVG。Tauri 会自动将其与背景合成。 |
| `android_fg_scale` | 前景在 Android 自适应图标中的缩放比例（百分比）。 |

### Android 前景层安全区

`android-foreground.svg` 中包含变换：

```svg
<g transform="translate(40, 40) scale(0.6)">
  <!-- Logo 主体 -->
</g>
```

这是为了满足 [Android 自适应图标安全区规范](https://developer.android.com/guide/practices/ui_guidelines/icon_design_adaptive)。**更新图标内容时必须保留此变换**，只替换内部路径数据。

---

## 4. 正确的更新流程

### 场景：更新应用图标

假设你已在设计工具中修改了 Logo，导出为 `vcpmobile.svg`：

#### Step 1：更新前端 Preloader 与 Favicon

```powershell
Copy-Item <新图标路径> public\vcpmobile.svg -Force
```

`index.html` 的 preloader 会自动引用此文件，无需额外修改。

#### Step 2：更新 Tauri 默认源图标

```powershell
Copy-Item public\vcpmobile.svg src-tauri\icons\icon.svg -Force
```

#### Step 3：同步更新 Android 前景层

**必须保留安全区变换**。打开 `src-tauri/icons/android-foreground.svg`，只替换 `<g transform="...">` 内部的路径数据，保留：

- `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">`
- `<g transform="translate(40, 40) scale(0.6)">`
- `</g>`

#### Step 4：重新生成所有平台图标

```powershell
pnpm tauri icon src-tauri/icon-manifest.json
```

此命令会：
- 读取 `icon-manifest.json`
- 为 Android 合成 `background + foreground` 分层图标
- 为 iOS / Windows / macOS 生成对应尺寸的 PNG/ICNS/ICO
- 输出到 `icons/` 和 `gen/android/.../mipmap-*/`

#### Step 5：验证

```powershell
pnpm check
```

确保没有编译错误。

---

## 5. 常见错误

### ❌ 错误：直接对单个 SVG 运行 `tauri icon`

```powershell
# 不要这样做！会丢失 Android 分层结构
pnpm tauri icon public\vcpmobile.svg
```

**后果**：
- Android 图标变成单一 PNG，失去自适应图标的背景/前景分层
- `android-background.svg` / `android-foreground.svg` 的配置被忽略
- 不同设备上图标可能被错误裁剪或拉伸

### ❌ 错误：修改 `android-foreground.svg` 时删除安全区变换

**后果**：Android 系统会在自适应图标形状内过度裁剪 Logo，导致边缘被切掉。

### ❌ 错误：手动修改 `gen/android/.../mipmap-*/` 下的 PNG

**后果**：这些文件是自动生成的，下次运行 `tauri icon` 会被覆盖。

### ❌ 错误：忘记更新 `public/vcpmobile.svg`

**后果**：前端 preloader 和 favicon 仍然是旧图标，与系统图标不一致。

---

## 6. 快速检查清单

更新图标后，确认以下位置均已同步：

- [ ] `public/vcpmobile.svg` — 前端 preloader + favicon
- [ ] `src-tauri/icons/icon.svg` — Tauri 默认源
- [ ] `src-tauri/icons/android-foreground.svg` — Android 前景（含安全区变换）
- [ ] `src-tauri/icons/android-background.svg` — Android 背景（如需要更改）
- [ ] `src-tauri/icon-manifest.json` — 配置正确指向上述文件
- [ ] 运行 `pnpm tauri icon src-tauri/icon-manifest.json` — 重新生成
- [ ] 运行 `pnpm check` — 验证编译
