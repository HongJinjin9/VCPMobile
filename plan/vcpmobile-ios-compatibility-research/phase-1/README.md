# Phase 1：平台能力与共享契约

> 工作区状态：未开始。2026-10-08 建立目录与阶段入口，详细子规划在本阶段启动时根据当时生产代码重新整理。

## 输入

Phase 0 审计交接；重点读取 phase-0/02、03、04。

## 既定范围

capability 的 support/implementation/authorization/runtime；Android/iOS/host cfg；main/portal 最小 ACL；目录 owner；lifecycle phase/sequence/snapshot DTO。

产品输入沿用 [D1–D19](../09-Magi综合裁决与待决策清单.md)，依赖顺序见 [总路线](../08-分期实施路线图与验收门禁.md)。本入口是工作区索引，不表示本阶段已实施。

## 启动时的第一项工作

从 App/启动/PermissionGate/Updater 的实际消费者倒推平台能力；先确定字段和唯一 owner，再同步 Rust/TS/ACL。

在本目录新增阶段子规划、逐路径任务、验证与交接记录。每条任务列出生产入口/owner、输入输出、异常/取消、资源释放、依赖、验证方法；以代码恢复现状，不从旧计划反推实现。

## 完成条件

Android 原路径与消费者保持；真实状态与错误语义闭合；跨层改动完成 pnpm check 及必要字段/取消/路径检查。

只登记实际执行的结果和仍待处理的问题；Apple 构建集中在 G1/G2 手动 Actions。进入下一阶段依据具体依赖和问题归属，不因独立待办阻断其他工作。
