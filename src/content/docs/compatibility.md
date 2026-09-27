---
title: "Node.js 24 兼容性"
description: "Node API 兼容性台账的数据分层与七种状态的判定依据"
group: "参考"
order: 4
source: "https://scriptc.dev/compatibility"
---

## 概览

scriptc 维护一份针对 Node.js 24 的 API 兼容性台账。完整数据（约 3,662 行）以交互式表格的形式发布在官方站点：https://scriptc.dev/compatibility ，可按模块、状态等条件筛选查询。本页不复制行数据，只说明这份台账是怎么来的、每个状态值如何判定。

## 数据来源与产物分层

台账在 scriptc 仓库的兼容性工作区包中维护，该包负责 scriptc 的 Node.js 对齐体系。

### 输入与支撑清单

- `node-v24.json`：固定（pin）Node 的发布 tag、commit，以及权威的文档与源码输入。
- `static-support.json`：在编译器自动生成的表层清单（surface manifest）之上，叠加专用编译器路径及其内部测试证据，覆盖静态层级。
- `dynamic-support.json`：由实现方维护的动态岛模块/全局对象注册表，覆盖动态层级。其 `globals.supported` 条目由常驻的 web prelude 安装，`globals.npmSupported` 条目仅由内嵌的 npm 模块引导程序安装。该文件还生成 `packages/runtime/src/scr_island_manifest.h`，使运行时导出与兼容性声明共享同一来源。

### 内部台账与公开产物

- `generated/node-v24-internal.json`：内部工程台账，包含实现证据与仓库测试路径。
- `generated/node-v24-backlog.json`：内部分层的工作队列，把工作分为验证、实现、替换显式拒绝、部分表面审计四类，并把稳定 API 排在实验性、已弃用和遗留 API 之前。
- `docs/src/generated/node-v24-compatibility.json`：文档站点消费的公开产物，由内部台账剥离而来。

内部工程台账与公开产物的区别：公开产物只含与编译器相关的运行时 API、状态、验证依据与用户可见的细节；文档、元数据、命令行/配置条目，以及在两个层级都不适用的行，仍留在内部。

## 状态一览

状态以证据为准，每种状态的判定依据如下：

| 状态 | 判定依据 |
| --- | --- |
| `supported` | 需要测试证据 |
| `partial` | 需要测试证据（仅部分表面可用） |
| `refused` | 需要显式的编译器诊断信息，或动态侧的抛错桩 |
| `not-implemented` | 所属 API 家族归 scriptc 所有但尚无实现匹配，属于可执行的工作队列项 |
| `by-design` | 记录的是架构性排除 |
| `unreviewed` | 尚待分类 |
| `not-applicable` | 对该执行层级而言不是运行时 API |

## 静态层级与动态层级

每个 API 的状态按执行层级分别记录，同一 API 在两个层级可以有不同结论：

- 静态层级：代码编译进原生运行时，由 `static-support.json` 在编译器生成的表层清单上叠加专用编译器路径与测试证据来记录。
- 动态层级：代码在 `--dynamic` 内嵌引擎（QuickJS 岛）中运行，由 `dynamic-support.json` 这个实现方拥有的注册表来记录模块与全局对象的支持情况。

一行若在两个层级都不适用，即 `not-applicable`，它不会出现在公开产物中。

## 更新与校验

改动 Node pin 或任一支持清单后，在仓库根目录运行 `pnpm node-compat` 重新生成台账产物。围绕台账的常用命令：

- `pnpm node-compat:backlog`：输出工作队列摘要。过滤器 `--tier`、`--action`、`--priority`、`--chapter`、`--status` 可组合使用，`--format=json` 或 `--format=tsv` 供工具消费。
- `pnpm node-compat:check`：离线的漂移/证据门禁。
- `pnpm --filter @internal/compatibility check:upstream`：额外通过网络校验固定的上游输入。
