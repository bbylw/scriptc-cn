---
title: "快速开始"
description: "从 npm 安装 CLI，在几分钟内编译出第一个原生可执行文件"
group: "开始使用"
order: 2
source: "https://scriptc.dev/quickstart"
---

从 npm 安装 CLI，在几分钟内编译出你的第一个可执行文件。

## 前置条件

- **macOS arm64** 是主要平台（[Linux 和 Windows](/docs/platforms) 是交叉编译目标）。

- **Node ≥ 24**：用于运行编译器。它产出的二进制文件完全不需要 Node。

- **clang**：随 Xcode Command Line Tools 预装；构建可执行文件时需要，但 `--emit=ir|c|llvm|asm|obj` 不需要。汇编/对象输出使用随 scriptc 一同安装的对应辅助程序，并需要 macOS 15 及以上。

## 安装

```bash
$ npm install -g scriptc
```

如果想改为从仓库克隆来工作（在仓库里执行 `pnpm install && pnpm build`，然后在仓库目录里执行 `pnpm scriptc`），请参阅 [代码仓库](https://github.com/vercel-labs/scriptc)。

## 你的第一个可执行文件

写一段普通的 TypeScript：

**hello.ts**

```ts
const who: string = process.argv.length > 2 ? process.argv[2] : "world";
console.log(`hello, ${who}`);
```

一步完成编译并运行：

```bash
$ scriptc run hello.ts
hello, world
```

或者生成可执行文件：

```bash
$ scriptc build hello.ts -o hello
$ ./hello scriptc
hello, scriptc
$ ls -la hello
-rwxr-xr-x  1 you  staff  329752  hello
```

这是一个独立的原生二进制文件：没有 Node，没有 node_modules，没有 JavaScript 引擎。它大约 4ms 就能启动，而 Node 打印同样这一行大约需要 ~35ms。

注意 `hello.ts` 里的 `process.argv.length` 保护：scriptc 的数组是稠密的，所以像 `process.argv[2]` 这样在缺少第三个参数时的越界读取，是一个运行时陷阱，而不是 `undefined`。这是已记录的[分歧](/docs/limitations)之一；编译器与运行时会告诉你，而不是悄悄产生分歧。

## 看看什么能编译

问一下编译器你的程序有多静态，以及确切地说哪些不静态：

```bash
$ scriptc coverage hello.ts

  statements analyzed   2
  compile statically    2  (100%)

  fully static - this program has no dynamic remainder.
```

对于导入 npm 包或使用 `any` 的程序，报告会指出每一处动态点和每一个阻碍项，并带上错误码。参见[覆盖率报告](/docs/coverage)。

## 使用一个 npm 依赖

npm 包在一个内嵌的 JavaScript 引擎里运行，通过 `--dynamic` 主动启用：

**cli.ts**

```ts
import pc from "picocolors";

function banner(text: string): string {
  return pc.bold(pc.green(text));
}

const args = process.argv.slice(2);
console.log(banner("scriptc demo"));
console.log(`args: ${args.length}`);
```

```bash
$ npm install picocolors
$ scriptc build cli.ts --dynamic -o demo
$ ./demo one two
scriptc demo
args: 2
```

包里的 JS 在构建时被内嵌进二进制文件：可执行文件从不读取 `node_modules`，可在任意位置运行。关于这一边界如何工作，参见 [npm 依赖](/docs/dependencies)。

## 下一步

- [CLI 参考](/docs/cli)：每个命令和标志，包括 `--emit`、`--backend llvm` 和 `--sanitize`。

- [原生程序对象](/docs/native-objects)：从外部 C 或链接器构建中消费 `app.o`。

- [平台支持](/docs/platforms)：用 zig 交叉编译到 Linux 和 Windows。

- [限制](/docs/limitations)：哪些还不能编译。
