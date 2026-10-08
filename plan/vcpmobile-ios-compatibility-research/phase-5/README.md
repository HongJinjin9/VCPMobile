# Phase 5：尽力后台

> 工作区状态：未开始。2026-10-08 建立目录与阶段入口，详细子规划在本阶段启动时根据当时生产代码重新整理。

## 输入

Phase 2 native 接入、Phase 3 attempt/terminal/settle 契约；与 Phase 4 可按依赖并行。

## 既定范围

iOS 26 continued-task availability、request/handler/expiration/completion；真实进度；前台常亮回退；单次终态。

产品输入沿用 [D1–D19](../09-Magi综合裁决与待决策清单.md)，依赖顺序见 [总路线](../08-分期实施路线图与验收门禁.md)。本入口是工作区索引，不表示本阶段已实施。

## 启动时的第一项工作

先明确 attemptId/taskId/generation 与单次 terminal，再对提交拒绝、迟到 handler、过期/取消/系统结束逐分支实现。

在本目录新增阶段子规划、逐路径任务、验证与交接记录。每条任务列出生产入口/owner、输入输出、异常/取消、资源释放、依赖、验证方法；以代码恢复现状，不从旧计划反推实现。

## 完成条件

真实字符/字节/可选 token 驱动进度；未知总量明确表达；所有结束路径释放资源；Bundle ID/task 前缀匹配，结果并入 G2。

只登记实际执行的结果和仍待处理的问题；Apple 构建集中在 G1/G2 手动 Actions。进入下一阶段依据具体依赖和问题归属，不因独立待办阻断其他工作。
