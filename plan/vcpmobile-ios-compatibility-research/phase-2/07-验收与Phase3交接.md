# Phase 2：验收与 Phase 3 交接

> 2026-10-08。**阶段二源码接入、工程输入和本地验证已完成；G1 Apple 构建仍待手动执行，阶段验收尚未关闭。** 施工基线 `aff70257`。阶段二与后续 Tauri 2.12.1 升级按用户授权一并本地提交，未推送或触发 Actions；下表保留升级前的阶段验证记录。

## 1. 交付结果

- Swift 静态 package、FFI binding、`ios_path`、真实 iOS plugin handle 和两个内部 selector 已连接。
- lifecycle capability 读取 Swift 实际观测；完整 network telemetry 等其余原生能力继续沿既定范围延期或待实现。
- Scene/App phase、NWPath Channel、Rust native sequence/epoch 和 Vue 恢复消费贯通。iOS 初始相位未知时不提前恢复，保留 inactive 与 background 的区别。
- 原生请求各保留至多一个底层 receiver；调用方取消/超时后的迟到响应不会触发上游 dropped receiver panic。
- iOS 15.0、单 Scene、隐私资源、图标与三条 SwiftPM 构建链的受控 resolution 已写入可重放工程输入；手动 G1 workflow 独立于现有 Android CI/Release。
- vendored tao 0.35.3 只改三个 iOS 文件，修复 Scene gate 和 delegate 返回对象所有权；来源、原始 checksum 与撤销条件完整登记。

入口与资源覆盖见 [01](./01-生产入口覆盖记录.md)，实现细节见 02–06。源码完成不代表已有可安装或可签名的 iOS 产物。

## 2. 已取得的验证

| 检查 | 实际结果 | 能说明什么 |
|---|---|---|
| `pnpm check` | 最终收尾退出 0，Rust host 无警告 | Vue/TypeScript 与 Rust host 静态检查 |
| `pnpm test:run` | 60 文件、505 项通过 | 共享前端回归；此后补充首次 null 相位门禁，定向 7 项再次通过 |
| Rust plugin `cargo test --locked -p tauri-plugin-vcp-mobile --lib` | 12 项通过 | 含 DTO、调用方取消、超时、迟到完成和在途上限 |
| Rust app `cargo test --locked --lib lifecycle_` | 12 项通过 | native 顺序/快照、Android linger、原 Chat 生命周期回归及 lifecycle capability 映射 |
| Rust app `cargo test --locked --lib platform::tests` | 4 项通过 | iOS lifecycle 真实观测映射不启用其他 adapter/设备遥测 |
| Android `cargo check --locked --offline --target aarch64-linux-android` | 退出 0，25.11 秒 | NDK 29.0.14206865、API 26、目标分支检查；没有构建 APK 或运行设备 |
| G1 source input check | 通过 | minimum、Scene、privacy、resolution、18 个 icon slot 尺寸 |
| G1 Python 行为检查 | 8 项通过 | overlay 重放/边界、未知模板/依赖漂移拒绝、已知 opener 旧锁迁移 |
| workflow YAML 解析 | 通过；仅 `workflow_dispatch`、`contents: read` | 结构与触发边界，不等同于 Actions 执行 |
| 公开命令/权限抽取 | 42 plugin / 176 app / 59 Kotlin；九组权限无差异 | 旧 Kotlin-only 抽取器对新增 Swift selector 报 1 项 unmatched 并退出 1；已按真实 Swift producer核对，详见 01 |
| tao 原始源对比 | 115 个未修改文件逐字节一致，3 个 iOS 文件有审查过的差异 | 本地依赖副本的变更边界；不证明 Apple 类型/链接已通过 |
| 原有工作树内容 | 9 个路径 SHA-256 全部保持 | package、pnpm lock、app build.rs、六个 permission 文件未被本任务修改 |
| 补丁空白检查 | `git diff --check` 通过；22 个新增自有文本文件无空白/末尾换行问题 | 未为格式检查改写 vendor 原始内容 |
| 文档相对链接 | 11 份本轮文档、37 个相对链接全部有效 | 阶段文档、工程 README 与 vendor 补丁说明的本地目标 |

Android 检查中出现一条 vendored tao `window.rs::hit_test` dead_code 警告：该函数来自未修改的上游源码。Cargo 将 path dependency 作为本地包后暴露该警告；没有为了消除它修改 Android/通用源。

未执行 Kotlin/Gradle 编译，因为本阶段没有修改 Kotlin、Android Manifest 或 Gradle 输入；取得的是 Android Rust 目标证据。未进行 Apple 编译、Simulator/设备操作、签名或发布。

## 3. 审查发现与闭环

1. **tao 单 Scene**：把“采用 Scene 生命周期”与“允许多个 Scene”分开，`UIApplicationSupportsMultipleScenes=false` 仍保留；首窗口创建继续等待 Scene connect。
2. **delegate 返回对象**：用 `Retained::autorelease_ptr` 保留返回的 UISceneConfiguration 至调用者取得它，避免原局部 Retained drop 后悬垂。
3. **迟到原生响应**：独立接收任务加两个有界槽位；测试确认调用方超时/abort 后底层发送仍成功。
4. **启动恢复竞态**：Swift lifecycle 回调虽然先入 Rust，但状态归约在线程池排队；network true 可能先到 Vue。iOS 在真实 active snapshot 前禁止恢复，消除这个窗口。
5. **SwiftPM 独立图**：VCP exact dependency 不能锁住 Tauri/opener 各自的 swift build。G1 为三个 root 设置受控 resolution，并校验实际 checkout revision。
6. **opener 自带旧锁**：锁定 opener 2.5.4 带 SwiftRs 1.0.6 的 v1 lock。只对包目录版本和完整 SHA-256 都匹配的上游输入迁移到受控 1.0.7，保存旧输入证据；未知漂移仍拒绝。
7. **签名输入名**：按当前 CLI 的真实 `IOS_CERTIFICATE`、`IOS_CERTIFICATE_PASSWORD`、`IOS_MOBILE_PROVISION` 读取点清理 unsigned G1 子进程环境，避免误读无关运行环境。

## 4. G1 尚待执行

[workflow](../../../.github/workflows/ios-g1.yml) 与 [工程说明](../../../src-tauri/ios/README.md) 已可审查。本地提交授权已经取得；仍需后续明确授权推送并手动运行 G1，回收 Apple 编译/链接与真实 archive 检查结果。当前 iOS 实施与 G1 保持暂停。

G1 主要核对 Swift/Objective-C 类型与 ABI、FFI 初始化符号、single Scene 配置、deployment target、三条 Swift resolution、device archive 与隐私资源实际装配。build-only 结果仍不能证明系统回调已在设备执行。若出现具体诊断，按 02–06 所列 owner 修复并集中复验。

## 5. Phase 3 可使用的输入与仍需完成的工作

| Phase 3 输入 | 已有 owner/行为 | 下一具体任务 |
|---|---|---|
| 原生 lifecycle | Rust LifecycleState、transition epoch、nullable snapshot | 按 active/inactive/background 将 Chat/Sync cancel/stop/join/flush 接在原领域 owner |
| 前台判断 | iOS 真实 background 更新现有 is_foreground | 回扫日志缓冲与回前台 flush；不复制 Android linger |
| 网络恢复 | 原 native Channel → Vue 同一恢复入口 | 回扫服务器连接恢复、错误重试与 trusted LAN 策略；NWPath 不代表服务器可达 |
| SQLite/Settings/Diary/CAS | Phase 1 目录边界及现有业务 owner | 验证初始化、持久化、迁移、错误与数据提交点；SQLite 不启用新动态扩展路径 |
| Sync | iOS 仍无 Phase 5 后台租约 | 先实现前台有界流程，并修正当前 `is_android` 不能代表所有移动平台的 loopback 策略 |
| native request/Channel | 两类请求有界保活，bootstrap 单次订阅 | 后续长任务加入 generation/terminal 时继续保留底层接收；订阅真失败现需用户重启，不新增无界 Channel |
| 工程 | iOS 15.0、受控单 Scene 与 G1 | 保存实际 Apple 诊断；G2 集成打包仍在 Phase 6 |

能力查询在订阅前可返回 runtime unknown；查询失败可重试，真实订阅 reject/source failure 不会被查询重试修好。前端不可把 implemented 当作已授权或当前一定可用。

后续独立源码任务可按依赖推进，但阶段二 G1 必须保持“待执行”，直到获得真实 Actions 结果。
