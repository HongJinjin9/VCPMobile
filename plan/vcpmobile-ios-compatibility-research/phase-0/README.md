# Phase 0：输入与目标源码审计

> 启动日期：2026-10-08。输入基线：`4c6e25bba72a9883f4c5270c1daf2493850bd04e` 加本轮开始时未提交工作树。
> 阶段状态和实际检查结果以 [05-验收记录与Magi交接.md](./05-验收记录与Magi交接.md) 为准；本阶段不代表 iOS 已能构建或运行。

## 工作入口

| 文档 | 内容 |
|---|---|
| [00-阶段子规划.md](./00-阶段子规划.md) | Phase 0 任务、边界、依赖与完成条件 |
| [01-输入基线与产品边界.md](./01-输入基线与产品边界.md) | 用户决定、当前源码、版本、工作树与维护输入 |
| [02-命令权限与消费者审计.md](./02-命令权限与消费者审计.md) | 可重复抽取、命令/ACL/native selectors 与真实消费者 |
| [03-依赖目标与Apple工程输入审计.md](./03-依赖目标与Apple工程输入审计.md) | cfg/features/build/FFI/Swift/模板/minimum 与具体问题 |
| [04-核心路径与阶段交接清单.md](./04-核心路径与阶段交接清单.md) | 启动、交互、附件、生命周期、后台的 owner 与后续任务 |
| [05-验收记录与Magi交接.md](./05-验收记录与Magi交接.md) | 执行结果、三方意见、剩余问题与 Phase 1 入口 |
| [evidence/input-baseline.json](./evidence/input-baseline.json) | 开始时已修改路径及原始字节 SHA-256；不是本轮完成快照 |
| [scripts/audit-command-surface.mjs](./scripts/audit-command-surface.mjs) | 从当前生产源抽取命令面；用法与限制见 02 |

研究正文 00–09 保留专题背景；各阶段施工细节和结果写在阶段目录，当前生产代码继续定义实现事实。下一个工作区为 [Phase 1](../phase-1/README.md)。
