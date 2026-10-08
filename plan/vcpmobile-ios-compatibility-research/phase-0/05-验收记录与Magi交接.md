# Phase 0：验收记录与 Magi 交接

> 日期：2026-10-08。阶段状态：**Phase 0 已完成，具备 Phase 1 开工输入**。Phase 1–6 尚未实施；本阶段没有 Apple 构建结果。

## 1. 本阶段交付

- Phase 0–6 均有专属目录和入口；Phase 0 展开 00–05 子规划/审计/交接文档，Phase 1–6 尚未实施。
- D1–D19、当前生产行为、minimum 工程选择和执行证据分别记录。
- 命令抽取脚本与来源快照覆盖 plugin/app/Kotlin/permissions/capability/消费者；具体限制和人工审计见 02。
- 依赖审计定位 cfg/features/C/FFI、Swift selector/队列、模板、资源和签名输入；11 个 DEP 问题已分配阶段。
- 产品边界、移动端 UI 规范及现行引用同步；保留 Android 生产契约与既有工作树修改。

## 2. 实际验证

| 检查 | 结果 | 能说明什么 |
|---|---|---|
| Node/pnpm/Rust/Cargo/Tauri CLI 版本 | 通过，见 01 | 本地输入可定位 |
| 6 条 Apple target `cargo tree --locked --offline` | 均退出 0，完整命令见 03 | 目标依赖解析与 feature 图，不是编译/链接 |
| `pnpm check` | 退出 0；vue-tsc 与 host cargo check 通过 | 当前工作树 TypeScript/Rust host 静态基线；不是 Apple 编译 |
| `node --check …/audit-command-surface.mjs` 与脚本 `--check` | 均退出 0；42 plugin / 176 app / 59 Kotlin，九组集合差为 0 | 脚本语法及来源快照一致；可达性边界见 02 |
| Markdown 链接与围栏检查 | 45 份文档、145 个相对链接目标均存在，围栏闭合 | 使用现有 marked 解析，排除 inline code 示例；不包含远端链接可用性 |
| 旧规范引用搜索 | 只剩两处更名记录及两处明确历史行号引用；现行链接无旧路径 | 导航迁移完成，历史证据未伪造新行号 |
| ignore 正反样本 | 15 项通过：8 项生成物/签名样本忽略、7 项维护输入可追踪 | 无实际凭据读取/写入；配置、Swift、plist、隐私与 resolution 源未被误忽略 |
| 继承修改 SHA-256 保留检查 | 未编辑的 17 个继承路径全部匹配原始字节 | 研究 README/01/08 仅追加实施导航/记录；其余既有修改保留 |
| `git diff --check` | 通过 | 已跟踪补丁无空白错误；不作为生产行为证据 |
| Apple 构建、签名、Actions、设备操作 | 未执行 | 均不在本阶段执行范围 |

## 3. Magi 汇合

| 视角 | 本次发现 | 处理结论 |
|---|---|---|
| Melchior | app IPC 总闸不覆盖 plugin；not(android) 误纳入 iOS；Swift future 取消可能触发上游 send unwrap | Phase 1 分清能力/cfg/ACL，Phase 2 保留最终回调接收和 generation 丢弃；不新增业务 owner |
| Balthasar | 启动权限与更新的调用/文案/挂载必须一起隔离；返回和 Insets 有 Android 语义；ImageIO 还须接已有 CAS 发送 | Phase 1 封闭入口，Phase 3/4 保留同一组件/状态树并逐路径接入 |
| Casper | product/binding、SwiftPM resolution、Scene gate、device archive runtime 检查均有精确条件 | 明确 Phase 2/G1 任务；不提前扩建验证体系、不升级框架碰运气 |

三方共同结论：Phase 0 用可复查输入和具体任务支持 Phase 1；原生附件和尽力后台仍是首产物范围。争议细项见 04 §4。规范名称按研究 01 的用户既定更名决定统一，不再沿用最初审查中保留旧名称的建议。

## 4. 剩余问题与下一步

| 优先级/归属 | 具体动作 | 闭环位置 |
|---|---|---|
| Phase 1 先行 | 由现有启动 owner 读取 typed capability，列清 PermissionGate/Updater/Root/CLI/Distributed/语音/附件各消费者 | 04 的核心路径表；在 phase-1 重新细化文件级子规划 |
| Phase 1 | 分拆 Android/iOS/host cfg、main/portal ACL、目录与 lifecycle DTO；保留 Android 既有数据根 | 02 命令矩阵与 03 DEP-01 |
| Phase 1 | 手动 Sync 的 battery 前置检查和 app `set_keepalive_mode` 单独审计；完整遥测延期不能自动推出删除最小业务条件 | 02 的人工消费者结论与真实调用方 |
| Phase 2/G1 | product/binding/selector/Channel、SwiftPM revision、tao Scene gate、取消桥接、minimum 与可重放 overlay | 03 DEP-02–06/08–10；G1 编译诊断 |
| Phase 3/4 | SQLite 临时目录/锁、Sync 终态、staging/取消/像素预算、WebKit 与输入差异 | 03 DEP-07/11、04 逐路径交接 |
| Phase 5/6 | continued-task 进度/单次终态、最终 ID 与签名输入、G2 archive/包检查 | 上位 04/06/07、各阶段新子规划 |

没有把上述后续施工记作本阶段完成。具体 API 或 G1 输入仍需跟进的项目不会阻断无依赖的 Phase 1 工作。

下一项工作在 [phase-1](../phase-1/README.md) 展开：先形成平台能力/cfg/ACL/目录/DTO 的文件级子规划，然后按真实消费者实施。iOS `15.0` 已作为工程输入确定，生产配置仍待 Phase 2 写入。
