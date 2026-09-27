---
title: "工作原理"
description: "从 tsc 前端到类型化 IR、LLVM 后端、链接与运行时的完整编译管线"
group: "参考"
order: 2
source: "https://scriptc.dev/how-it-works"
---

## 编译管线

```text
TypeScript ──tsc: parse + typecheck──▶ lowering ──▶ typed IR ──▶ LLVM IR ──scriptc LLVM helper──▶ assembly/object
                                             │          │             └──precompiled runtime + linker──▶ executable
                                             │          └─────▶ C ────────────────C compiler/linker─────┘
                                             └── serialized IR
```

1. **前端**：由真正的 TypeScript 编译器针对 `es2025`（当项目包含 `@types/node` 时一并加载）解析并类型检查你的程序，检查器的严格程度遵循你的 `tsconfig.json`。随后前端把通过检查的 AST 降级为类型化的中间表示，用 tsc 自己给出的类型与收窄结论来驱动每一个决定。任何没有降级规则的构造，都会在这一阶段得到精确的诊断信息，绝不会留到后面变成误编译。

2. **类型化 IR**：两端之间唯一的接口，一份经过校验、可序列化的表示（`--emit=ir` 把它写成 JSON 后停止）。在这里类型已是具体的：泛型已单态化，联合类型是带标签的值，闭包拥有显式的捕获。

3. **后端**：`--emit=c` 写出可读的 C 后停止；`--emit=llvm` 写出文本形式的 LLVM IR 后停止。这两个源码级输出命令都不会探测或调用原生工具链。在受支持的 macOS、Linux 与 Windows 宿主上（以及 WASI 目标），`--emit=asm|obj` 会把 LLVM IR 发给一个版本匹配、运行在独立进程中的 LLVM 22 辅助程序；它不需要 clang 或链接器。可执行文件构建默认使用 LLVM，遇到 LLVM 层之外的原生程序时可以回退到 C（在 stderr 给出一条提示；`--backend llvm` 会锁定 LLVM，并在同样的情况下改为以诊断信息失败）。生产环境的 `wasm32-wasi` 目标从不回退。

4. **链接**：发布包为每个受支持的目标包含每个运行时特性单元一个预编译对象，外加 QuickJS、libregexp、zlib 和 mbedTLS 归档。一份带哈希的清单把 IR 特性门控映射为有序的、类型化的链接计划，因此二进制依旧只为用到的部分付出代价。用户需要目标平台的链接器和 SDK/sysroot，但普通的 LLVM 层构建不编译任何 C。AddressSanitizer、显式 C 构建以及 LLVM 拒绝接管的场景，仍会走外部 C 工具链路径。

程序对象定义 `main`，并让它们选用的 `scr_*` 运行时函数保持未定义。对 `scr_runtime_abi_v1` 的引用是一次强制的链接期兼容性检查。`--print=native-link-info` 会暴露外部构建所需的精确源码运行时包与链接顺序；该对象 ABI 目前处于实验阶段，要求运行时版本精确匹配，不具备 semver 稳定性。

你可以自行检查任意阶段：

```bash
$ scriptc build fib.ts --emit=ir
$ ls .scriptc/
fib.ir.json
$ scriptc build fib.ts --emit=c
$ ls .scriptc/
fib.c
fib.ir.json
$ scriptc build fib.ts --emit=llvm
$ ls .scriptc/
fib.c
fib.ir.json
fib.ll
$ scriptc build fib.ts --emit=asm
$ ls .scriptc/
fib.c
fib.ir.json
fib.ll
fib.s
$ scriptc build fib.ts --emit=obj
$ ls .scriptc/
fib.c
fib.ir.json
fib.ll
fib.o
fib.s
```

## 运行时

- **内存**：值采用引用计数；一个无环的值在其最后一个引用消失的瞬间释放。引用环由一个环路回收器在确定的回收点收集，而不是靠并发 GC。没有 GC 停顿，也没有追踪式堆。

- **并发**：`async`/`await` 运行在有栈纤程上，调度与 JS 完全一致：微任务的排空顺序与 Node 相同，定时器的触发顺序相同，事件循环（macOS 上用 kqueue，Linux 上用 epoll）没有外部依赖。

- **服务器栈**：`net`、`http`、`https`、`tls`（内置的 mbedTLS）、`dgram`、`dns` 都是构建在同一个事件循环上的原生实现。

- **数值**：与 JS 完全一致的 f64 语义，包括最短往返的数字转字符串格式化，并已与 Node 的输出做过模糊验证。

- **正则表达式**：与 QuickJS 使用的同一个 ECMAScript 完全一致的字节码解释器，只链接进使用正则的二进制。

## 正确性保障：差分测试

scriptc 对正确性的声明不是"我们实现了规范"，而是"我们把你的语义与 Node 的语义并跑，结果一致"。每次变更都有两条通道来强制执行这一点：

- **差分语料库**：每个语料程序既在 Node 下运行，也作为编译后的二进制运行；stdout、stderr 和退出码必须**逐字节**一致。服务器由真实的客户端驱动分别对两种实现进行压测。数字格式化还额外对 Node 的 `String(x)` 在一百万个随机 double 上做过模糊验证。

- **内存安全通道**：整个语料库在 AddressSanitizer 下重跑，并在退出时做引用计数审计；任何一处泄漏或释放后使用都是构建失败。同样的通道也可以用于你的程序，即 `scriptc build --sanitize`。

在无法与 Node 逐字节一致、或有意不以此为目标的场景（时间相关的内部机制、错误对象的内部结构、动态边界处的别名化），这些分歧都会被**记录并编号**，参见 [限制](/docs/limitations)。分歧空间为空这一事实是有重量的：已验证一致清单记录的是经过验证的内容，而不仅仅是假设。

## 动态岛

`--dynamic` 会为 [npm 依赖](/docs/dependencies) 和 `any` 类型代码内嵌 quickjs-ng。从架构上看，这座岛是第二个世界，有自己的堆和自己的微任务队列；两个世界之间的边界会复制值，并在运行时校验每一次从动态到静态的跨界。静态代码从不信任这座岛：一个撒谎的类型会成为一个可捕获的 `TypeError`，而不是内存损坏。

## 仓库布局

| 包 | 它是什么 |
| --- | --- |
| `packages/compiler` | 前端（tsc API → IR）、带校验器与序列化器的类型化 IR、C 与 LLVM 后端、原生辅助程序集成，以及覆盖率分析器。 |
| `native/llvm-codegen` | LLVM 22 边车程序（sidecar），负责校验、优化并产出目标汇编或对象文件。 |
| `packages/runtime` | C 运行时：带环路回收器的引用计数值、纤程与事件循环、服务器栈、与 JS 完全一致的数字格式化、岛之间的胶水层。 |
| `packages/runtime-darwin-arm64` | 发布构建的运行时对象包，以及它的目标、ABI、特性、哈希、系统库、编译器与许可证清单。 |
| `packages/cli` | `scriptc build \| run \| coverage`。 |

仓库 README 介绍了开发工作流。
