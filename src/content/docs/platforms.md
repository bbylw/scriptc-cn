---
title: "平台支持"
description: "scriptc 支持的目标平台、交叉编译方式与各交叉目标的限制"
group: "指南"
order: 5
source: "https://scriptc.dev/platforms"
---

## 自有 LLVM 目标

用 `--emit=ir|c|llvm` 选择的源码级产物只需 Node。在受支持的宿主上，`--emit=asm|obj` 使用随 scriptc 安装的版本匹配的平台辅助程序，不调用编译器、归档器、链接器或 SDK。受支持的汇编/对象目标为：macOS arm64/x64（产出 macOS 14.0 目标产物；辅助程序需要 macOS 15+）、Linux x64/arm64 glibc、Windows x64 MSVC、Linux x64/arm64 musl，以及 WASI Preview 1。普通的 LLVM 层可执行文件额外需要平台链接器与 SDK/sysroot；辅助程序产出程序对象，打包的运行时提供对象/归档，因此该链接驱动既不编译程序的 C 代码，也不编译运行时的 C 代码。显式 C 构建、LLVM 回退路径和 `--sanitize` 仍需要 C 编译器。对象输出保留未定义的运行时引用，不是库归档。

## 经由 zig 交叉编译

scriptc 可以从 macOS 上交叉编译，使用 zig 内置的 clang 与 sysroot。安装 [zig](https://ziglang.org) 后，用两个环境变量选择它：

- `SCRIPTC_CC=zigcc`：使用 zig 的 clang 作为 C 编译器。
- `SCRIPTC_TARGET=<triple>`：目标三元组；GNU/Linux 目标会附带 glibc 版本。

### Linux（arm64、x86_64）

```bash
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=aarch64-linux-gnu.2.36 scriptc build fib.ts -o fib-linux
$ file fib-linux
fib-linux: ELF 64-bit LSB executable, ARM aarch64, version 1 (SYSV), dynamically linked, interpreter /lib/ld-linux-aarch64.so.1, for GNU/Linux 2.0.0, with debug_info, not stripped
```

运行时自上而下都有原生 Linux 后端：事件循环是 epoll（macOS 上为 kqueue），服务器栈与 TLS（带发行版 CA 束探测）以及 `fs.watch` 都有 Linux 实现，并在基于容器的差分测试通道中对照 Linux 版 Node 验证。`x86_64-linux-gnu.2.36` 的用法相同。Alpine 容器请使用 `<arch>-linux-musl`；Zig 会为 AArch64 或 x86_64 产出静态链接的可执行文件，同一套静态运行时面已在 Alpine 上对照 Node 验证。

### Windows（x86_64）

```bash
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=x86_64-windows-gnu scriptc build fib.ts -o fib.exe
$ file fib.exe
fib.exe: PE32+ executable (console) x86-64, for MS Windows
```

完整测试语料库在差分测试通道中对照 Windows 版 Node 运行，包括 `--dynamic` 程序与 `child_process`。Windows 夹具通道还会经由 `net`、`http`、`https`、`tls`、`http2`、`dgram` 和 `dns` 处理真实的回环流量，外加原生 `fetch` 实现（包括重定向、流式响应体、压缩、取消与代理处理）。

Windows 可执行文件构建默认使用控制台子系统。对于自己拥有窗口的应用，设置 `--windows-subsystem=gui`，这样 Windows 就不会再打开一个额外的控制台窗口。它在链接时选择 PE 子系统，对两种后端都有效。

### iOS 与 Android（arm64，库模式）

三个移动端三元组构建供宿主应用链接的**库模式静态归档**：移动应用本身就是可执行文件，因此不带 `--lib` 的 `scriptc build` 会以 `SC3002` 拒绝这些目标：

- `SCRIPTC_TARGET=aarch64-apple-ios`：iOS 设备归档（Mach-O，arm64）。需要 macOS 宿主以及 Xcode 的 iPhoneOS SDK。每个对象都带有 `LC_BUILD_VERSION`，最低系统版本为 15.0。
- `SCRIPTC_TARGET=aarch64-apple-ios-simulator`：iOS 模拟器归档（Mach-O，arm64，模拟器平台）。需要 macOS 宿主以及 Xcode 的 iPhoneSimulator SDK。同样以 iOS 15.0 为最低版本。
- `SCRIPTC_TARGET=aarch64-linux-android`：Android 归档（ELF，arm64），针对 NDK 的 bionic 头文件在 API 级别 26 上编译，宿主应用的 `minSdkVersion` 必须不低于 26。需要 Android NDK：设置 `ANDROID_NDK_ROOT`，或使用 `ANDROID_HOME` 及默认 SDK 位置下最新的 `ndk/<version>`。

```bash
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=aarch64-apple-ios scriptc build --lib --profile app.profile.json
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=aarch64-linux-android scriptc build --lib --profile app.profile.json
```

完整的库模式特性集全部适用：由 profile 声明的导出与 ABI 入口点、宿主回调通道（`callbacks` 加 `abi.callback_register_symbol`）、契约附属文件、确定性围栏、`abi.localize_runtime`（多实例归档：Mach-O 本地化在两个 iOS 平台上都调用 macOS 宿主链接器；Android 则与 Linux 交叉目标一样走同一套进程内 ELF 本地化），以及 `abi.instance_per_thread`（按线程实例化的状态）。归档的外部符号约定不变：仅对目标的 C/数学运行时与系统 API 保留未定义引用，由 Xcode 针对所选 SDK 的链接或 API 26+ 的 NDK clang 链接解析。归档探针在模拟器与仿真器中的执行属于测试矩阵的一部分；设备架构归档则经过构建与链接验证。

### WebAssembly（WASI Preview 1）

设置 `SCRIPTC_CC=zigcc` 和 `SCRIPTC_TARGET=wasm32-wasi` 即可产出独立的 `.wasm` 模块。不带 `-o` 时，`scriptc build hello.ts` 会写入 `.scriptc/hello.wasm`。`scriptc run` 用 Node 的 WASI 实现承载该模块，继承标准输入输出与环境变量，把当前工作目录预打开为 `/`，并把宿主平台的临时目录映射为客户机的 `/tmp`。构建出的模块也可以改为在其他 WASI Preview 1 宿主中运行。

WASI 是一个生产级 LLVM 目标，拥有与原生目标相同的语言层级。其 32 位 LLVM ABI 支持集合、闭包、异常、类、受检动态值、async/await、Promise、同步与异步生成器、定时器、stdin/readline 事件、进程退出监听器、文件系统回调与 Promise，以及 `--dynamic` QuickJS 岛。仅用于调试的 C 后端只对不含协程的程序可用，且必须显式传入 `--backend c`；依赖协程的程序会报 `SC3001`，WASI 绝不会静默回退到 C。

剩余的可执行边界是宿主能力，而不是语言覆盖面。WASI Preview 1 没有可移植的套接字、进程派生、操作系统信号、网络接口或文件系统通知 API。因此网络/fetch、子进程、信号 API、`os.networkInterfaces()` 和 `fs.watch` 会在链接前以诊断信息 `SC3002` 失败。`--sanitize`、原生 FFI 和库模式归档构建同样不可用。文件系统行为受宿主的预打开目录约束，进程/操作系统自省则遵循 WASI 的精简模型。

## 交叉目标限制

- `--sanitize` 是宿主构建通道。
- 库模式静态归档是原生宿主嵌入产物；`wasm32-wasi` 会以 `SC3002` 拒绝 `scriptc build --lib`。
- 移动端三元组仅支持库模式：构建独立可执行文件会以 `SC3002` 拒绝，且移动端只支持库可容纳的面（即库归档能够链接的、不含协程的静态层级）。
- iOS 目标只能在 macOS 宿主上构建（Apple SDK sysroot 与 Mach-O 本地化）；Android 目标可在任何装有 NDK 的宿主上构建。
- 如上文所述，WASI 无法承载 Preview 1 缺失能力的 API。

## 汇总

| 平台 | 方式 | 状态 |
| --- | --- | --- |
| macOS arm64 / x64 | 原生宿主辅助程序 + 运行时包 | 完整覆盖面、`--dynamic`、sanitizer 通道（外部 C 路径） |
| Linux arm64 / x86_64 | 原生宿主辅助程序 + 运行时包；`SCRIPTC_TARGET=<arch>-linux-musl` 选择 musl | 静态与动态覆盖面，含服务器、TLS、fetch、fs.watch 和 child_process；可执行文件链接需要匹配的 libc/sysroot |
| Windows x86_64 | 原生 x64 MSVC 辅助程序 + 运行时包 | 静态与动态覆盖面，含服务器、TLS、fetch 和 child_process；可执行文件链接需要 Windows SDK/MSVC CRT |
| iOS arm64（设备与模拟器） | `SCRIPTC_CC=zigcc SCRIPTC_TARGET=aarch64-apple-ios` 或 `aarch64-apple-ios-simulator`，macOS 宿主加 Xcode | 仅库模式（`--lib`）：面向 Xcode 工程的静态归档，最低 iOS 15.0；支持多实例与按线程实例化的 profile；测试矩阵在模拟器中执行 |
| Android arm64 | `SCRIPTC_CC=zigcc SCRIPTC_TARGET=aarch64-linux-android`，任何装有 NDK 的宿主 | 仅库模式（`--lib`）：面向 Gradle/NDK 工程的静态归档，最低 API 级别 26；支持多实例与按线程实例化的 profile；测试矩阵在仿真器中执行 |
| WebAssembly / WASI Preview 1 | 匹配的宿主辅助程序 + WASI 运行时包 | 生产级 LLVM 目标；完整的语言层级与动态层级，受 WASI P1 宿主能力约束 |
