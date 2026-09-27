---
title: "介绍"
description: "scriptc 把 TypeScript 编译为原生可执行文件的核心理念与静态层级说明"
group: "开始使用"
order: 1
source: "https://scriptc.dev/introduction"
---

**scriptc 把普通的 TypeScript 编译为小巧、快速的原生可执行文件**：二进制文件里没有 Node，没有 V8，也没有 JavaScript 引擎。无需改动你的代码：不需要注解，不需要方言，也不需要特殊的标准库。还是你在 Node 上运行的那份 TypeScript，由真正的 TypeScript 编译器做类型检查，再编译为原生代码。

```bash
$ cat fib.ts
function fib(n: number): number {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}
console.log(fib(30));

$ scriptc run fib.ts
832040

$ scriptc build fib.ts -o fib && ./fib
832040
```

产物是一个约 320KB 量级的独立可执行文件，启动只需几毫秒，除系统 C 库外不链接任何东西：

```bash
$ otool -L fib
fib:
        /usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)
```

## 理念：看得见的静态性

大多数 TypeScript 比整个生态所假设的要静态得多。scriptc 逐个构造地判断哪些能编译为原生代码，并且会告诉你。程序中每个构造恰好落在三个层级中的一个，层级就是承诺：

1. **静态编译**：原生代码，没有引擎。这是默认模式，也是唯一的模式，除非你主动放弃静态。留在这一层级的程序，其 stdout 与在 Node 下运行同一文件逐字节相同，退出码也相同，除了一份简短、带编号、已记录在案的分歧清单之外。

2. **动态运行**（配合 `--dynamic`）：一个内嵌的 JavaScript 引擎（[quickjs-ng](https://github.com/quickjs-ng/quickjs)，约 620KB）执行那些无法静态化的部分：npm 依赖自带的 JS，以及 `any` 类型代码。每个回穿进静态代码的值都会在运行时校验：一个说谎的类型会抛出一个可捕获的 `TypeError`，而不是破坏内存。

3. **拒绝编译**：其余一切都在编译期失败，附带一个具体的错误码、一段代码帧，通常还有一个改写提示。不会有任何代码被静默地编译错误。

[覆盖率报告](/docs/coverage) 会让你程序里的层级一目了然：

```bash
$ scriptc coverage cli.ts

  statements analyzed   4
  compile statically    3  (75%)

  runs with --dynamic   2 sites (embeds a JS engine, ~620KB - static stays the default)
      ×1  importing 'picocolors' requires the embedded dynamic engine, which this build does not include - the package's implementation runs there  SC2013
      ×1  values from the 'picocolors' package run in the embedded dynamic engine, which this build does not include                                SC2013
```

## 哪些能静态编译

静态层面覆盖了真实程序会使用的语言和标准库：

- **语言**：带单继承与动态分派的类，带 JS 捕获语义的闭包，泛型函数声明（单态化），由 TypeScript 自身的类型收窄驱动的可辨识联合，调度与 JS 完全一致的 `async`/`await`，带 `finally` 的异常，解构，展开，可选/默认/剩余参数，getter 和 setter，迭代器，模板字符串，按位运算符（ToInt32 语义与 JS 完全一致），以及正则表达式的静态子集。

- **标准库**：字符串（表层语义与 UTF-16 完全一致），任意精度的 `bigint`，数组，`Map` 和 `Set`（顺序与 JS 完全一致），只读的 `Date` 值与日历 getter，`JSON`（带运行时校验的类型转换），`Math`，类型化数组与 `Buffer`，以及带类型化 `catch` 的 `Error` 层级。

- **Node 的 API 表面**：`fs`（同步与 promise）、`path`、`process`、`child_process`、`os`、`crypto`、`url`/`URL`、`zlib`，在一个无依赖事件循环上的定时器和信号处理器，以及服务端技术栈：`net`、`http`、`https`、`tls`、`dgram`、`dns`、`readline`。真实的服务器可以编译：

**server.ts**

```ts
import { createServer } from "node:http";

const server = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ path: req.url, pid: process.pid }));
});

server.listen(8080, () => {
  console.log("listening on http://localhost:8080");
});
```

```bash
$ scriptc build server.ts -o server && ./server &
listening on http://localhost:8080
$ curl -s http://localhost:8080/status
{"path":"/status","pid":90126}
```

程序针对 TypeScript 真正的 `es2025` 库做类型检查（项目里有 `@types/node` 时也一并加上），而你的 `tsconfig.json` 决定检查器的严格程度。任何被触及却没有降级实现的东西，都会给出一条精确的诊断信息，绝不会是意外。[限制页面](/docs/limitations) 用平实的语言列出了哪些不能编译，以及哪些是设计上就存在的分歧。

## 逃生舱及其代价

- **`--dynamic`** 为 [npm 依赖](/docs/dependencies) 和 `any` 类型代码内嵌引擎。`scriptc coverage --dynamic` 会精确报告哪些语句在哪里运行。静态仍是默认：二进制文件绝不会悄悄长出一个引擎。

- **受检转换**：`JSON.parse(...) as Config` 会插入一次运行时校验，抛出一个指明出错路径的可捕获错误。TypeScript 的 `as` 是一个承诺；scriptc 会去验证它：

```bash
$ cat cast.ts
type Config = { port: number };
try {
  const cfg = JSON.parse('{"port": "eighty"}') as Config;
  console.log(cfg.port);
} catch (e) {
  if (e instanceof Error) console.log(`caught: ${e.message}`);
}

$ scriptc run cast.ts
caught: expected number at $.port, got string
```

- **`comptime(() => ...)`** 在构建时运行 TypeScript（在编译器内部一个隔离的 VM 中），并把结果作为字面量烘焙进二进制文件：

```bash
$ cat banner.ts
const build = comptime(() => `built ${new Date().toISOString().slice(0, 10)}`);
console.log(build);

$ scriptc run banner.ts
built 2026-07-22
```

## 以正确性为方法论

有两个强制执行机制在每次改动时运行：

- **差分测试**：语料库里的每个程序既在 Node 下运行，*也*作为原生二进制运行；stdout、stderr 和退出码必须逐字节一致。数字格式化与 JS 完全一致（最短往返表示，并通过针对 Node 的模糊测试验证）。服务器则用实时的客户端驱动对两种实现分别测试。

- **内存安全通道**：整个语料库在 AddressSanitizer 下重跑，并做一次引用计数审计；内存泄漏和释放后使用都算构建失败。

这些有意为之的、与 Node 的分歧（大多围绕计时的内部细节和错误对象属性）都有记录并编了号；没有任何东西会悄悄分歧。[工作原理](/docs/how-it-works) 介绍了其背后的架构。

## 下一步看什么

- [快速开始](/docs/quickstart)：构建编译器和你第一个二进制文件。

- [CLI 参考](/docs/cli)：每个命令和标志。

- [覆盖率报告](/docs/coverage)：如何阅读 `scriptc coverage` 的输出。

- [npm 依赖](/docs/dependencies)：内嵌引擎的机制。

- [限制](/docs/limitations)：哪些不能编译，以及原因。
