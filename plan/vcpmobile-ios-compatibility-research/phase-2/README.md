# Phase 2：Swift 插件与生命周期

> 工作区状态：未开始。2026-10-08 建立目录与阶段入口，详细子规划在本阶段启动时根据当时生产代码重新整理。

## 输入

Phase 1 的能力、目录、命令及 lifecycle DTO。

## 既定范围

iOS 配置、SwiftPM/binding/register_ios_plugin、Channel snapshot、Scene 与线程/取消语义；可重放 Apple 工程生成输入。

产品输入沿用 [D1–D19](../09-Magi综合裁决与待决策清单.md)，依赖顺序见 [总路线](../08-分期实施路线图与验收门禁.md)。本入口是工作区索引，不表示本阶段已实施。

## 启动时的第一项工作

先复核锁定 CLI/tao/Swift API 和 Phase 0 的 Scene gate、SwiftPM resolution 待办，写出本阶段子规划；在确定 DTO 上接通 producer→subscribe→bootstrap。

在本目录新增阶段子规划、逐路径任务、验证与交接记录。每条任务列出生产入口/owner、输入输出、异常/取消、资源释放、依赖、验证方法；以代码恢复现状，不从旧计划反推实现。

## 完成条件

源码接入闭合后手动 Actions G1 debug device archive；记录编译/链接/资源/注册诊断。禁止以 host check 宣称 Apple 编译通过。

只登记实际执行的结果和仍待处理的问题；Apple 构建集中在 G1/G2 手动 Actions。进入下一阶段依据具体依赖和问题归属，不因独立待办阻断其他工作。
