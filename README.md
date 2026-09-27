# scriptc

<p>
  <a href="https://vercel.com/labs#active-experiments"><img alt="Vercel Labs Experiment" src="https://img.shields.io/badge/LABS-EXPERIMENT-0a0a0a.svg?style=for-the-badge&amp;logo=Vercel&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/scriptc"><img alt="npm version: scriptc" src="https://img.shields.io/npm/v/scriptc.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://github.com/vercel-labs/scriptc/blob/main/LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/github/license/vercel-labs/scriptc.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/scriptc"><img alt="npm downloads per month: scriptc" src="https://img.shields.io/npm/dm/scriptc.svg?style=for-the-badge&amp;labelColor=000000&amp;label=npm%20downloads" height="28"></a>
</p>

scriptc 将 TypeScript 与 JavaScript 编译为带类型的中间表示（IR）、可读的 C 代码、文本形式的 LLVM IR、原生汇编与对象文件、原生可执行文件，以及 WebAssembly 模块。它使用 TypeScript 编译器进行解析与类型检查。源码级输出只需 Node 即可生成。在 macOS 15 及以上、arm64 架构上，普通的 LLVM 层可执行文件会采用 scriptc 内置的辅助程序与预编译运行时包；clang 仅作为平台链接驱动，不会编译程序或运行时的 C 代码。

静态构建包含一小段原生运行时，但不含 Node 或 JavaScript 引擎。无法静态编译的代码会被作为诊断信息报告出来。对于 npm 包与 `any` 类型代码，`--dynamic` 会显式内嵌 [quickjs-ng](https://github.com/quickjs-ng/quickjs)。

scriptc 目前仍处于实验阶段，目标平台包括 macOS、Linux、Windows，以及通过 WASI Preview 1 支持的 WebAssembly。

## 安装

编译器要求 Node.js 24 或更高版本。`--emit=ir|c|llvm` 仅需 Node 即可。`--emit=asm|obj` 会使用随 scriptc 一同安装在受支持的 macOS、Linux、Windows（以及 WASI）宿主上的对应可选平台辅助程序，但不需要编译器、归档器、链接器或 SDK。普通的 LLVM 层可执行文件构建需要平台链接驱动与 SDK/sysroot，但使用的是内置辅助程序加预编译运行时包，而不是去编译生成出的或运行时的 C 代码。设置 `SCRIPTC_LINKER` 可选择该驱动。显式的 C 构建、LLVM 回退路径、`--sanitize`，以及已弃用的 `SCRIPTC_CC=clang|zigcc` 兼容方案，还需要额外安装一个 C 编译器。它所生成的可执行文件不依赖 Node。

```console
$ npm install -g scriptc
```

## 构建程序

创建 `hello.ts`：

```ts
const who = process.argv.length > 2 ? process.argv[2] : "world";
console.log(`hello, ${who}`);
```

一步完成编译并运行：

```console
$ scriptc run hello.ts
hello, world
```

或者生成一个独立可执行文件：

```console
$ scriptc build hello.ts -o hello
$ ./hello ctate
hello, ctate
```

或者停在源码级编译器产物这一步，无需调用 clang、归档器或链接器：

```console
$ scriptc build hello.ts --emit=ir >/dev/null
$ ls .scriptc/
hello.ir.json
$ scriptc build hello.ts --emit=c >/dev/null
$ ls .scriptc/
hello.c
hello.ir.json
$ scriptc build hello.ts --emit=llvm >/dev/null
$ ls .scriptc/
hello.c
hello.ir.json
hello.ll
$ scriptc build hello.ts --emit=asm >/dev/null
$ ls .scriptc/
hello.c
hello.ir.json
hello.ll
hello.s
$ scriptc build hello.ts --emit=obj >/dev/null
$ ls .scriptc/
hello.c
hello.ir.json
hello.ll
hello.o
hello.s
```

不同类型的产物会累积在 `.scriptc/` 目录中；重新构建某一类型会更新对应的文件。

`--emit=obj` 写出的是可重定位的程序对象，而非独立的库。它带有未定义的 `scr_*` 运行时引用，以及必需的 `scr_runtime_abi_v1` 标记；`scriptc build --lib --profile ...` 仍是自包含的归档接口。该辅助程序运行于 macOS 15 及以上 arm64 环境，产出的目标文件部署目标为 `arm64-apple-macosx14.0.0`。在辅助程序的 AddressSanitizer 管线与可执行文件路径匹配之前，带 sanitizer 的汇编/对象输出会被拒绝。

外部对象的消费仍处于实验阶段。使用 `--print=native-link-info` 可输出对象文件，并打印一份带版本的 JSON 配方，其中包含目标平台、`main` 入口、精确的 `@scriptc/runtime` 源码包、所需系统库、FFI 输入以及 ABI 标记。该配方绝不会使用隐藏的 scriptc 缓存路径。有关 C 驱动与直接调用 Apple 链接器的构建方式，请参阅 [`examples/native-object`](https://github.com/vercel-labs/scriptc/tree/main/examples/native-object)。

## 使用 Node API

受支持的 Node API 会被编译进原生运行时。例如 `server.ts`：

```ts
import { createServer } from "node:http";

const server = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ path: req.url }));
});

server.listen(8080, () => {
  console.log("listening on http://localhost:8080");
});
```

```console
$ scriptc build server.ts -o server
$ ./server
listening on http://localhost:8080
```

## 查看静态覆盖率

`scriptc coverage` 会显示程序中能够静态编译的比例，并为每一处动态或不被支持的代码点给出带编码的诊断信息。

```console
$ scriptc coverage hello.ts

  statements analyzed   2
  compile statically    2  (100%)

  fully static — this program has no dynamic remainder.
```

## 构建 WebAssembly

WASI 及其他交叉目标构建需要 Zig。其内置的 WASI libc 通过生产级 LLVM 后端生成可移植的 WASI Preview 1 模块：

安装 Zig，并确保 `zig` 可执行文件位于你的 `PATH` 中。`SCRIPTC_CC=zigcc` 是 scriptc 用来调用 Zig 的 `cc` 子命令的选择器；`zigcc` 并不是一个独立的可执行文件。

```console
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=wasm32-wasi scriptc build hello.ts --no-keep-c -o hello.wasm >/dev/null
$ file hello.wasm
hello.wasm: WebAssembly (wasm) binary module version 0x1 (MVP)
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=wasm32-wasi scriptc run hello.ts
hello, world
```

WASI 目标支持与原生目标相同的可执行语言层级，包括 async/await、Promise、生成器、定时器、stdin/readline 事件、回调式与 Promise 式文件系统 API，以及 `--dynamic`。需要可移植 WASI Preview 1 所不具备能力的 API（例如网络套接字/fetch、子进程、操作系统信号以及文件系统监视）会在链接前以 `SC3002` 错误失败；sanitizer 构建、原生 FFI 以及库模式的归档构建同样属于目标诊断错误。有关精确的边界，请参阅 [platform support](https://scriptc.dev/platforms)。

## 使用 npm 包

传入 `--dynamic` 可将某个 npm 包的 JavaScript 内嵌进可执行文件。生成的产物在运行时不会读取 `node_modules`。

```ts
import pc from "picocolors";

console.log(pc.green("hello from scriptc"));
```

```console
$ npm install picocolors
$ scriptc build cli.ts --dynamic -o cli
$ ./cli
hello from scriptc
```

## 文档

完整的工作流请参阅 [quickstart](https://scriptc.dev/quickstart) 与 [CLI reference](https://scriptc.dev/cli)。文档还描述了 [npm dependencies](https://scriptc.dev/dependencies)、[native FFI](https://scriptc.dev/ffi)、[platform support](https://scriptc.dev/platforms)，以及当前的 [limitations](https://scriptc.dev/limitations)。

## 开发

```console
$ pnpm install && pnpm -r build
$ vercel link && vercel env pull  # 写入项目作用域的 VERCEL_OIDC_TOKEN
$ pnpm test:sandbox
```

常规的 workspace 构建不需要在本地安装 LLVM。若要重新构建原生辅助程序/运行时包，需在该目标宿主上安装 CMake、Ninja，以及固定版本的 LLVM 22 开发包，然后运行对应的 `@scriptc/llvm-<platform>` 与 `@scriptc/runtime-<platform>` 的 `build:native` 脚本。macOS 的完整测试套件同样会用到这些生成的产物。

`pnpm test:sandbox` 会加载 `.env.local`，预先校验 Vercel 认证与项目访问权限，并默认使用托管的 `vercel/sandbox/universal` 镜像。它会在每个一次性 Sandbox 中安装仓库锁定的 Node、pnpm 与 LLVM 工具链，以及 ScriptC 依赖，然后再构建上传的 worktree。只有当你想使用 `pnpm test:sandbox:image` 提供的可选预构建镜像时，才需要把 `SCRIPTC_SANDBOX_IMAGE` 设置为一个完整限定的 VCR 引用。预构建镜像可保持约四分钟的快速路径；而冷启动的托管镜像运行更慢，因为它们要在每个 Sandbox 中安装锁定的工具链。

`VERCEL_OIDC_TOKEN` 是首选方式。若使用访问令牌认证，需设置 `VERCEL_TOKEN`、`VERCEL_TEAM_ID` 与 `VERCEL_PROJECT_ID`；团队与项目绝不从 `SCRIPTC_SANDBOX_IMAGE` 推断得出。`pnpm test:sandbox:image` 所用的旧版 VCR 命令无法用 OIDC JWT 进行认证，因此镜像构建在有 `VERCEL_TOKEN` 时使用它，否则回退到已有的 Vercel CLI 登录态；OIDC 声明仍会选中对应的 VCR 团队与项目。测试语料库会在 Node 下以及作为编译后的原生二进制分别运行每个程序，然后逐字节比对 stdout、stderr 与退出码。完整的门禁还会使用 AddressSanitizer 以及运行时引用计数审计来运行该语料库。
