# Phase 2：Swift 插件与生命周期

> **当前状态：iOS 实施与 G1 已按用户要求暂停。** Tauri 升级改用官方 tao 0.37.1，替代本阶段的本地补丁；已有 Swift 输入只做兼容维护。以下记录保留阶段二原始基线与验证范围，新依赖审计见 [升级记录](../../tauri-2.12-upgrade/03-iOS既有输入与补丁撤销.md)。

> 交付状态：源码接入与本地验证已完成，G1 Apple 构建待执行。2026-10-08 从 Phase 1 提交 `aff70257` 开始；按用户授权将阶段二与其当前依赖的 Tauri 2.12.1 升级一并本地提交，未推送或触发 Actions。没有以 host/Android 检查代替 Apple 证据。

## 输入

Phase 1 的能力、目录、命令及 lifecycle DTO。

## 既定范围

iOS 配置、SwiftPM/binding/register_ios_plugin、Channel snapshot、Scene 与线程/取消语义；可重放 Apple 工程生成输入。

产品输入沿用 [D1–D19](../09-Magi综合裁决与待决策清单.md)，依赖顺序见 [总路线](../08-分期实施路线图与验收门禁.md)。本轮逐路径任务、异常和验证边界见 [阶段子规划](./00-阶段子规划.md)。

## 本轮记录

已按锁定 CLI/tao/Swift API 接通 producer→subscribe→bootstrap，并完成单 Scene 最小框架修正、受控 SwiftPM 输入与 G1 手动入口。

| 文档 | 内容 |
|---|---|
| [00-阶段子规划](./00-阶段子规划.md) | 基线、范围、逐路径任务与三方审查 |
| [01-生产入口覆盖记录](./01-生产入口覆盖记录.md) | 实际调用链、命令/权限集合、资源上限与限制 |
| [02-Swift原生事件与资源](./02-Swift原生事件与资源.md) | Swift producer、真实 snapshot、主队列与资源释放 |
| [03-Rust桥接与能力契约](./03-Rust桥接与能力契约.md) | FFI、DTO、能力映射与取消/超时接收 |
| [04-生命周期接入与并发审计](./04-生命周期接入与并发审计.md) | native sequence、Rust epoch、前端恢复门控 |
| [05-Apple工程与G1入口](./05-Apple工程与G1入口.md) | 工程重放、SwiftPM、工具输入与归档检查 |
| [06-Scene与框架审计](./06-Scene与框架审计.md) | tao 最小补丁、首窗口与 Scene 装配 |
| [07-验收与Phase3交接](./07-验收与Phase3交接.md) | 实际验证、G1 待执行项与下一阶段输入 |

## 完成条件

源码接入闭合后手动 Actions G1 debug device archive；记录编译/链接/资源/注册诊断。禁止以 host check 宣称 Apple 编译通过。

只登记实际执行的结果和仍待处理的问题；Apple 构建集中在 G1/G2 手动 Actions。进入下一阶段依据具体依赖和问题归属，不因独立待办阻断其他工作。
