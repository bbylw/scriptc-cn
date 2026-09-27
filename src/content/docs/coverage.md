---
title: "覆盖率报告"
description: "分析你的程序有多少语句能静态编译为原生代码"
group: "指南"
order: 1
source: "https://scriptc.dev/coverage"
---

`scriptc coverage` 回答的是“我的程序有多少编译成了原生代码？”这个问题。它在不构建的情况下分析程序，把每条语句归入一个层级。没有全局排行榜，也没有含糊其辞：数字是针对*你的*程序的，并且每个非静态位点都会以错误码指名。

## 完全静态的程序

```bash
$ scriptc coverage app.ts

  statements analyzed   10
  compile statically    10  (100%)

  fully static - this program has no dynamic remainder.
```

这是有类型的应用代码的常见情况：整个程序变成原生代码，`scriptc build` 产出的可执行文件不带任何引擎。

## 含动态残余的程序

导入一个 npm 包，报告就会换一副样子：

```bash
$ scriptc coverage cli.ts

  statements analyzed   4
  compile statically    3  (75%)

  runs with --dynamic   2 sites (embeds a JS engine, ~620KB - static stays the default)
      ×1  importing 'picocolors' requires the embedded dynamic engine, which this build does not include - the package's implementation runs there  SC2013
      ×1  values from the 'picocolors' package run in the embedded dynamic engine, which this build does not include                                SC2013
```

逐行解读：

| 行 | 含义 |
| --- | --- |
| `statements analyzed` | 你的程序中每条可执行语句（不含依赖）。 |
| `compile statically` | 变成原生代码的语句，不涉及任何引擎。 |
| `runs with --dynamic` | 如果你改用 `--dynamic` 重新构建，*将会*在内嵌引擎中运行的位点。不加该标志时，每一处都是编译错误：这个构建不包含引擎，也绝不会悄悄包含。 |
| `blockers` | 在*任何*层级下都尚无法编译的语句，每条带计数、一行原因和它的 `SC` 码。这些属于被拒绝层级：用 `--dynamic` 重新构建并不会让它们消失。 |

## --dynamic 视图

`scriptc coverage --dynamic` 回答的是另一个问题：**`--dynamic` 构建会编译什么，还有什么被阻塞？**

```bash
$ scriptc coverage cli.ts --dynamic

  statements analyzed   4
  compile statically    3  (75%)
  compile dynamically   1  (25%) (island sites - the embedded engine runs them)

  builds with --dynamic - no remaining blockers (the island sites above run in the embedded engine).
```

结尾一行就是可执行的结论：该程序可以用 `--dynamic` 构建。当结论不是这样时，剩余的阻塞项会照静态视图的方式逐条列出。

## 内嵌内置模块报告

当内嵌的 npm 代码导入 Node 内置模块时，`--dynamic` 报告会如实说明：内嵌依赖图触及的每个内置模块、它在引擎内是否有垫片，以及是哪个包要用它：

```bash
$ scriptc coverage tool.ts --dynamic

  statements analyzed   5
  compile statically    2  (40%)
  compile dynamically   3  (60%) (island sites - the embedded engine runs them)

  embedded npm code imports Node builtins:
    node:child_process  shimmed  (commander)
    node:events         shimmed  (commander)
    node:fs             shimmed  (commander)
    node:path           shimmed  (commander)
    node:process        shimmed  (commander)
    node:util           shimmed  (commander)

  builds with --dynamic - no remaining blockers (the island sites above run in the embedded engine).
```

这些垫片是引擎内的重新实现，不是 Node 本身。其含义见 [npm 依赖](/docs/dependencies)。

## 阻塞线的含义

阻塞行带有 `SC` 错误码，与 `scriptc build` 报错所用的码完全相同，因此覆盖率报告和编译器永远不会互相矛盾。几种常见形态：

- `'X' is part of the standard library types but has no scriptc lowering yet (SC2020)`：类型检查器看到的是完整标准库，但只有受支持的部分能编译。该位点的构建错误会附带受支持替代方案的提示。
- `importing 'pkg' requires the embedded dynamic engine (SC2013)`：npm 包的实现运行在引擎里；要么加 `--dynamic`，要么去掉这个依赖。
- `'Response.arrayBuffer() in a static build' is typed but has no scriptc lowering yet (SC2020)`：`fetch` 本身是原生静态的；字节体请用 `Response.bytes()`，要更广的 Web API 就用 `--dynamic`。
- `passing 'unknown' values where 'any' is expected (SC1100)`：`any`/`unknown` 的边界规则；先做窄化或类型转换。

## 类型错误会拦下分析

覆盖率只分析能通过类型检查的程序。存在 TypeScript 错误的程序会报告这些错误，而不是给出数字：

```bash
$ scriptc coverage broken.ts

  not analyzable: 1 TypeScript error - fix type errors first (scriptc only analyzes programs that typecheck)
```

这是有意为之：层级归属由类型驱动，在类型不正确的程序上算出的数字只是虚构。

## 外部宿主的类型接口

一些应用运行在某个嵌入方内部，由它提供 `node_modules` 中并不存在的模块。当这个嵌入方自带一份重述该类型接口的声明文件时，可以在覆盖率分析中把它的精确裸标识符映射过去：

`scriptc coverage src/core.ts --external-types @native-sdk/core=types/native-sdk-core.d.ts`

该选项可重复使用。相对的声明文件路径从当前工作目录解析；接受 `.d.ts`、`.d.mts` 和 `.d.cts` 文件。声明会参与类型检查，因此使用该声明结构类型的项目自有模块和本地值都能被统计。纯类型导入不新增运行时边界。相对的声明导入与再导出也会被纳入，所以映射的文件可以是常规的 `index.d.ts` 汇总文件。

这一映射刻意不声称宿主模块能在 scriptc 可执行文件中执行。值的导入与使用会以 `SC1010` 外部宿主阻塞项的形式出现，而覆盖率继续统计应用的其余部分。该选项仅在 `scriptc coverage` 上可用；构建仍然需要真实的模块实现或显式的运行时集成。
