---
title: "命令行参考"
description: "scriptc 命令、参数 flag 与环境变量的完整参考。"
group: "参考"
order: 1
source: "https://scriptc.dev/cli"
---

CLI 共有四个命令。`scriptc --help` 打印的就是下面这份接口。

```bash
$ scriptc --help
scriptc：将 TypeScript/JavaScript 编译为原生与 WebAssembly 可执行文件（实验性）

Usage:
  scriptc build <file.ts|.js> [options]     编译为可执行文件或源码产物
  scriptc run <file.ts|.js> [options]       编译并运行
  scriptc coverage <file.ts|.js>            统计可静态编译的比例，以及不能的原因
  scriptc coverage <file.ts|.js> --dynamic  查看 --dynamic 构建能编译什么、还有什么在阻碍
  scriptc coverage <file.ts|.js> --external-types <specifier=file.d.ts>
                                            为分析而类型解析嵌入方提供的模块
  scriptc cache warm [runtime|tls|dynamic…] 为当前编译器/SDK/目标预构建开销大的原生缓存族
```

## scriptc build

把 TypeScript（或 JavaScript）入口文件编译为序列化的带类型 IR、可读的 C、文本形式的 LLVM IR、原生汇编、可重定位目标文件、原生可执行文件；选择 `wasm32-wasi` 目标时则编译为 WebAssembly 模块。程序会先经过类型检查，由真正的 TypeScript 编译器完成，并遵循最近的 `tsconfig.json`。任何没有 lowering 的构造都会成为编译错误，带有 `SC` 前缀的错误码、代码帧，通常还附带重写提示。

```bash
$ scriptc build fib.ts -o fib
$ ./fib
832040
```

不带 `-o` 时，主产物落在输入文件旁边的 `.scriptc/` 目录中。源码级输出有固定的后缀，并在原生编译之前停止：

```bash
$ scriptc build fib.ts --emit=ir >/dev/null
$ ls .scriptc/
fib.ir.json
$ scriptc build fib.ts --emit=c >/dev/null
$ ls .scriptc/
fib.c
fib.ir.json
$ scriptc build fib.ts --emit=llvm >/dev/null
$ ls .scriptc/
fib.c
fib.ir.json
fib.ll
$ scriptc build fib.ts --emit=asm >/dev/null
$ ls .scriptc/
fib.c
fib.ir.json
fib.ll
fib.s
$ scriptc build fib.ts --emit=obj >/dev/null
$ ls .scriptc/
fib.c
fib.ir.json
fib.ll
fib.o
fib.s
```

不同类型的产物会累积在 `.scriptc/` 目录中；重新构建某一类型会更新对应的文件。

三种源码级输出只需要 Node。在 macOS 15 及以上、arm64 架构上，汇编和对象输出使用随 scriptc 安装的匹配原生辅助程序，不会调用外部编译器、归档器、链接器或 SDK。产出的对象文件是带有未定义 `scr_*` 运行时符号和必需的 `scr_runtime_abi_v1` 标记的可重定位程序对象，不是独立的库。外部消费仍处于实验阶段，且要求使用 `--print=native-link-info` 报告的确切运行时版本。该选项仍会写出对象文件，不执行链接，并打印一份带版本的 JSON 配方，其中包含目标平台、`main` 入口、已安装的源码运行时包、FFI 输入以及系统库。它绝不会报告 scriptc 的私有缓存路径。完整的 C 驱动与直接调用链接器的示例参见 [原生程序对象](/docs/native-objects)。`--emit=exe` 是默认值。在 macOS 15 及以上、arm64 架构上，LLVM 层构建通过辅助程序产出程序对象，并链接以 release 构建的运行时目标文件；显式 C 构建、LLVM 回退构建和 sanitizer 构建仍会编译运行时 C。

## scriptc run

先执行 `build`，再运行生成的二进制，stdio 直接继承。对于 `wasm32-wasi`，CLI 通过 Node 的 WASI Preview 1 宿主启动模块，把当前工作目录预挂载为 `/`，并把宿主机的 `/tmp` 暴露为客户机的 `/tmp`。

```bash
$ scriptc run fib.ts
832040
```

注意：`run` 不会把多余的命令行参数转发给程序。若要传参，请先 `build` 出可执行文件，再直接调用它。

## scriptc coverage

分析程序但不产出二进制，逐语句报告哪些可以静态编译、哪些需要内嵌的动态引擎、哪些完全被阻碍。加上 `--dynamic` 则回答另一个问题：`--dynamic` 构建能编译什么，还有什么在阻碍。两种形态都会在 [覆盖率报告](/docs/coverage) 中详细讲解。

## scriptc cache warm

为那些仍在本地编译运行时 C 的目标，预构建 release 运行时对象以及原生 TLS/动态引擎归档。macOS 15 及以上、arm64 的安装已自带以 release 构建的运行时包，会跳过自动预热；更早的 macOS 宿主仍保留面向源码工具链路径的预热。在为其他受支持的目标准备容器镜像或 CI runner 时使用此命令。传入 `runtime`、`tls`、`dynamic` 中的一个或多个，可只为这些族播种缓存。

## 选项

| flag | 说明 |
| --- | --- |
| `-o, --out <path>` | 主产物路径。显式给出的路径即精确路径。默认值依次为 `.scriptc/<name>.ir.json`、`.c`、`.ll`、`.s`、`.o`，或平台默认的可执行文件名。 |
| `--emit <ir\|c\|llvm\|asm\|obj\|exe>` | 选择本次调用的唯一主产物。`ir`、`c`、`llvm` 只需要 Node。`asm` 和 `obj` 在受支持的 macOS、Linux、Windows 宿主以及 WASI 上使用随附的匹配 LLVM 辅助程序，不需要安装 C 编译器。`exe` 是默认值。 |
| `--print <native-link-info>` | 构建一个对象文件（等价于 `--emit=obj`），然后以 JSON 打印其机器可读的外部链接配方，而不是打印产物路径。该文档会列出确切的已安装源码运行时包和全部链接输入，但不会调用链接器。 |
| `--dynamic` | 内嵌动态引擎（约 620KB），使 npm 依赖和 `any` 类型代码可以运行。静态编译仍是默认。没有此 flag 时，属于动态层的代码点会逐处报编译错误。参见 [npm 依赖](/docs/dependencies)。 |
| `--ffi <file>` | 将仅声明签名的 TypeScript 声明绑定到原生 C ABI 符号，并链接清单中的归档、对象文件和系统库输入。参见 [原生 FFI](/docs/ffi)。 |
| `--backend <c\|llvm>` | 代码生成器：`llvm`（默认）或 `c`（可读的调试后端）。在受支持的平台上，LLVM 层可执行文件代码生成会先使用内置辅助程序和预编译运行时包，再进行平台链接。未设置时，若程序超出 LLVM 层范围，原生构建可以回退到 C。生产用的 `wasm32-wasi` 目标绝不回退：缺少 LLVM lowering 即为 `SC3001`。 |
| `--strip` | 链接可执行文件时移除符号和调试负载，包括交叉编译的目标。这个需显式启用的 flag 对两种后端以及 `--from-c` 均有效，且不改变代码优化。 |
| `--optimization <release\|dev>` | 选择可执行文件、汇编或对象输出的原生优化级别。默认是 `release`（`-O2`）。`dev` 使用 `-O0`，并为 TypeScript 和 JavaScript 断点与栈帧生成源码位置。LLVM 构建会包含源码变量名和原生存储描述；支持的表示形式见 [原生调试](/docs/limitations#原生调试)。macOS 可执行文件构建还会在旁生成一个 `.dSYM` 包。 |
| `--windows-subsystem <console\|gui>` | 选择 Windows 可执行文件的子系统。`console` 是默认值；`gui` 会阻止 Windows 为应用打开控制台窗口。仅对以 Windows 为目标的可执行文件构建有效，包括 `--from-c`。 |
| `--npm-static <pkg[,pkg…]\|auto>` | 实验性。把指定 npm 包随包发布的 JS 作为程序模块静态编译，而不是为引擎内嵌（可重复使用；`auto` 为所有符合条件的直接导入选择加入）。预检拒绝的包会带着覆盖率报告中的备注回退到引擎孤岛。成熟度说明见 [npm 依赖](/docs/dependencies)。 |
| `--provenance-sources` | 实验性。从 npm 依赖带有来源认证的源码（在认证所指提交处抓取）进行编译，作为静态程序模块；没有可用认证的包仍走引擎路径（给出备注，绝不导致失败）。 |
| `--external-types <specifier=file.d.ts>` | 仅用于 coverage。把一个精确的裸模块说明符映射到嵌入方提供的本地声明文件。多个模块可重复此选项。声明文件提供检查器类型，使应用覆盖率分析可以继续；运行时导入和值仍是显式的 `SC1010` 阻碍项。相对路径从当前工作目录解析。接受的文件以 `.d.ts`、`.d.mts` 或 `.d.cts` 结尾。 |
| `--sanitize` | 构建带 AddressSanitizer 及运行时引用计数审计的可执行文件，即编译器自身测试语料库运行的同一条通道。在辅助程序的 sanitizer 管线与可执行文件路径匹配之前，`--emit=asm|obj` 会拒绝此选项。 |
| `--emit-ir` | 附加的 IR 侧产物。用于可执行文件构建时将在一个发布周期内弃用；当 IR 就是主输出时，请优先用 `--emit=ir`。库模式保留 `--emit-ir`，因为 `--emit` 不用于选择库产物。 |
| `--keep-c` / `--no-keep-c` | 保留（默认）或删除生成到可执行文件旁边的程序转换单元：默认 LLVM 后端下是 `.ll` 文件，`--backend c` 下（以及默认构建发生回退时）是 `.c`。生成的 C 可读，并带有源码行注释。 |
| `--from-c` | 把输入当作 C（或 `.ll`）文件处理。用于工具链管线和调试。这些任意转换单元会绕过持久产物缓存，因为其头文件依赖图由调用方自行管理。 |
| `-h, --help` | 显示用法。 |

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `SCRIPTC_CACHE_DIR` | 覆盖持久构建缓存的根目录。默认值：设置了该变量时用 `$XDG_CACHE_HOME/scriptc/build`；macOS 上为 `$HOME/Library/Caches/scriptc/build`；Windows 上为 `%LOCALAPPDATA%\scriptc\cache\build`；其他平台为 `$HOME/.cache/scriptc/build`。缓存存放经校验和验证的、按内容寻址的可执行文件、库归档以及按变体区分的运行时对象。缓存标识包含编译器解析出的系统头文件依赖以及链接器/汇编器标识。编译器本身仍是必需的，以便每次启用缓存的调用都重新发现依赖选择。带归档/对象输入或环境系统库（`system_libraries`）的 FFI 构建始终针对其当前依赖重新链接，同时保留运行时对象复用。可变的编译器输入路径（如 `CPATH` 和 `SDKROOT`）以及编译器包装器会绕过持久产物和对象，防止就地重建的依赖变成过期内容。不透明的归档器包装器会重建库的程序成员和归档，同时保留运行时对象复用。直接的 Clang、Apple 的系统 Clang shim、`zig cc`、可信的平台归档器以及 `zig ar` 保留各自适用的持久层级。已存在的 POSIX 覆盖目录必须本来就是私有的；否则将绕过缓存，且不会修改该目录的权限。 |
| `SCRIPTC_NO_CACHE` | 设为 `1` 可绕过所有构建缓存的读取和写入。显式把 `SCRIPTC_CACHE_DIR` 设为空值有同样效果。 |
| `SCRIPTC_CACHE_MAX_MB` | 构建缓存的最大容量，单位为兆字节。默认是 `4096`。默认缓存会周期性清扫；显式配置的上限则在每次成功写入缓存后检查。缓存超过上限时，移除最近最少使用的条目。 |
| `SCRIPTC_CC` | 用于显式 C 构建、sanitizer 构建、临时 LLVM 回退路径以及交叉编译的 C 编译器。`zigcc` 选择 zig 自带的 clang，并启用其自带 sysroot 进行交叉编译。在 macOS arm64 上，设置 `SCRIPTC_CC=clang|zigcc` 会选择一条已弃用的传统可执行文件路径；要走内置辅助程序/运行时包路线，请保持其未设置。 |
| `SCRIPTC_LINKER` | 普通 macOS arm64 LLVM 层可执行文件的平台链接驱动。该驱动只接收辅助程序产出的程序对象、预编译的运行时对象/归档、FFI 输入和系统库；它负责定位平台 SDK 和 CRT 输入，但不编译 scriptc 生成物或运行时 C。 |
| `SCRIPTC_TARGET` | 交叉编译的目标三元组，例如 `aarch64-linux-gnu.2.36`、`x86_64-windows-gnu` 或 `wasm32-wasi`。WASI 构建默认输出 `.wasm` 文件名。参见 [平台支持](/docs/platforms)。 |

```bash
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=aarch64-linux-gnu.2.36 scriptc build fib.ts -o fib-linux
$ file fib-linux
fib-linux: ELF 64-bit LSB executable, ARM aarch64, version 1 (SYSV), dynamically linked, interpreter /lib/ld-linux-aarch64.so.1, for GNU/Linux 2.0.0, with debug_info, not stripped
```

## 后端

默认后端产出文本形式的 LLVM IR。在受支持的平台上，它由内置辅助程序降级为目标文件，并与匹配的预编译运行时包一起链接；`SCRIPTC_LINKER` 独立于 C 编译，控制平台链接驱动。超出 LLVM 层范围的程序绝不会被错误编译：原生构建会透明地回退到 C 后端，并在 stderr 输出一行说明。生产用的 `wasm32-wasi` 目标使用 LLVM 的 32 位 ABI 路径，从不回退；LLVM 覆盖缺口会成为一条构建诊断信息。动态 npm 内嵌在所有目标上都属于 LLVM 层面。

若要在 Xcode 或 LLDB 中设置源码断点，请用 `--optimization=dev` 构建。在 Xcode 自定义构建规则中，把该选项加到 `scriptc build` 调用里，并把可执行文件及其 `.dSYM` 包都列为输出。将 `.dSYM` 包保持在可执行文件旁边，并让原始源码文件保留在构建时的路径上。LLVM 和 C 后端都会跨导入模块保留源码位置。

C 后端是一个调试辅助：它刻意产出可读的、带源码行注释的输出，并在两者重叠之处与 LLVM 做差分测试。当你想检查程序变成了什么时，可以钉住它：

```bash
$ scriptc build fib.ts --backend c -o fib
$ ./fib
832040
$ head -1 fib.c
/* Generated by scriptc from fib.ts. Do not edit. */
```

显式的 `--backend llvm` 会钉住 LLVM 后端：遇到本应回退的情况时，它不再回退，而是以诊断信息 SC3001 失败并指明不受支持的构造。这适合那些必须察觉层级变化的 CI 通道。

## 工具要求

| 操作 | Node | 编译器 | 链接器 / SDK |
| --- | --- | --- | --- |
| `coverage`、`--emit=ir\|c\|llvm` | 必需 | 不使用 | 不使用 |
| `--emit=asm\|obj`（macOS 15 及以上 arm64） | 必需 | 内置的 scriptc LLVM 辅助程序 | 不使用 |
| 用所报告的源码运行时包外部链接 `--emit=obj` | 产物不使用 | 运行时源码需要 C 编译器 | 需要 macOS 链接器和 SDK |
| `--emit=exe` | 运行 scriptc 所需 | clang 或所选的交叉编译器 | 由该编译器驱动决定 |
| `--from-c` | 运行 scriptc 所需 | 必需 | 必需 |
