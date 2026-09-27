---
title: "npm 依赖"
description: "通过 --dynamic 内嵌 quickjs-ng 引擎运行 npm 包的动态孤岛机制"
group: "指南"
order: 2
source: "https://scriptc.dev/dependencies"
---

npm 包是动态前沿：它们随包发布的 JavaScript 没有类型、经过压缩，并且是面向 V8 编写的。scriptc 的应对方案是**动态孤岛**：一个内嵌的 JavaScript 引擎（[quickjs-ng](https://github.com/quickjs-ng/quickjs)，约 620KB），在你的可执行文件内部执行依赖代码，用 `--dynamic` 显式启用；每个值在跨回静态代码时都会经过校验。

## 孤岛的故事

**tool.ts**

```ts
import { Command } from "commander";

const program = new Command();

program
  .name("greet")
  .argument("<name>", "who to greet")
  .option("-u, --upper", "shout it")
  .action((name: string, opts: { upper?: boolean }) => {
    const text = `hello, ${name}`;
    console.log(opts.upper ? text.toUpperCase() : text);
  });

program.parse();
```

```bash
$ npm install commander
$ scriptc build tool.ts --dynamic -o greet
$ ./greet ada --upper
HELLO, ADA
```

逐步来看发生了什么：

1. **解析**：`commander` 按 Node 自身的解析算法从你的 `node_modules` 中解析出来，并遵循 package.json 的 `exports` 条件。
2. **类型**：包自带的 `.d.ts` 就是你的代码进行类型检查所依据的类型接口，与在 Node 项目中完全一致。
3. **内嵌**：包的 JavaScript（以及它导入的一切，按同样方式解析）在**构建时**被内嵌进可执行文件。可执行文件在运行时从不读取 `node_modules`，它可以在同一平台上任意机器的任意目录下运行。
4. **执行**：内嵌代码在引擎中以完整的 JavaScript 语义运行：是真正的 `commander`，未经修改。
5. **边界**：值以拷贝方式跨界，绝不以引用方式。你的回调的带类型参数（`name: string`）在调用时接受校验：如果包传入了不是字符串的东西，那是一个可捕获的 `TypeError`，而不是内存损坏。

你自己的代码（`.action` 回调体、它调用的函数）仍然静态编译。引擎只运行必须动态的部分，而 [`scriptc coverage --dynamic`](/docs/coverage) 会显示精确的划分，包括内嵌包导入了哪些 Node 内置模块，以及每个是否被垫片化。

可执行入口是 TypeScript 的 workspace 包会作为你的程序的一部分自动编译，包括包内部那些解析到 `.ts` 源码的 `.js` 导入拼写。随包发布可执行 JavaScript 的 workspace 包则沿用常规的依赖策略：要么用 `--dynamic` 走孤岛，要么把它们加入 `--npm-static`。

## 孤岛是什么

- **它是 quickjs-ng，不是 V8。** 内嵌的依赖代码运行是正确的，但在 CPU 密集的工作下比在 Node 下慢。收益在于启动、体积、内存和部署形态，而不是依赖的原始吞吐量。
- **是垫片，不是 Node。** 要求内置模块（`node:events`、`node:path`、`node:process` 等）的内嵌包代码，会得到忠实还原的岛内实现，其中一些直接桥接到静态代码使用的同一套原生运行时函数。覆盖率报告会列出内嵌依赖图触及的每个内置模块；未被垫片化的会被报告出来，绝不悄悄打桩。
- **边界按拷贝。** 流入依赖代码的静态值按值编组；动态代码做出的修改对静态原值不可见，反之亦然。在 JS 会发生别名的地方，scriptc 采用拷贝，这是记录在案的一处[差异](/docs/limitations)。
- **`any` 类型的代码也在岛内运行。** 在 `--dynamic` 下，检查器判定为 `any` 的表达式在引擎中以完整 JS 语义执行，且每条 `any` → 静态的边都是一次经过校验的出口。
- **每个进程只有一个引擎**，首次使用时惰性创建。不含孤岛的 `--dynamic` 构建与静态构建发出相同的代码。

## --npm-static（实验性）

`--npm-static <pkg[,pkg…]|auto>` 要求编译器把指定包**移出**孤岛：它们随包发布的 JavaScript 作为程序模块进行静态编译，类型信息取自它们自己的 `.d.ts`。

这是实验性的。真实的包能以高但部分的覆盖率完成静态编译。静态编译器无法处理的位点会被*延后*：构建成功，报告会列出每个延后的位点，但运行时一旦触及其中一个，就会得到一个指明具体不支持操作的错误。有些包的代码会直接撞上静态边界，今天无法静态构建；被预检拒绝的包会带着一条覆盖率说明回退到孤岛。如果某个包对你的静态构建很重要，试一试并阅读报告，答案是逐包具体的。

## --provenance-sources（实验性）

`--provenance-sources` 更进一步：对于带 npm 出处证明（provenance attestation）发布的包，编译器会获取该证明所指提交处的包**源码**并编译那份源码：TypeScript 按 TypeScript 编译，而不是编译随包发布的 JS。没有可用证明的包仍走引擎路径，并附带一条说明，绝不会导致失败。成熟度方面的注意事项与 `--npm-static` 相同。

## 这套设计能撑多大

设计目标是不加修改地运行真实世界的包。开发时使用的标尺是已发布的 [Vercel CLI](https://www.npmjs.com/package/vercel)：直接从 registry 取包，用 `--dynamic` 编译成一个自包含的可执行文件，运行它的真实工作流，替代了约 120MB 的 Node 运行时加 181MB 的 `node_modules`。

## 当前限制

- 没有自带或已安装类型声明的包会通不过类型检查门禁（标准的 `Could not find a declaration file` 错误）：添加 `@types/<pkg>` 或本地声明即可，就像在任何严格 TypeScript 项目中那样。
- 类实例和 Promise 无法*流入* `any` 位（岛内没有对应表示）；闭包只能在特定形态下作为宿主函数跨界。每一处拒绝都是一条说明修复方式的编译错误。
