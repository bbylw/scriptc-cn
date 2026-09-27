---
title: "原生程序对象"
description: "说明 --emit=obj 产物的 ABI、链接信息与外部原生链接方式"
group: "指南"
order: 3
source: "https://scriptc.dev/native-objects"
---

在受支持的目标平台上，`scriptc build --emit=obj` 会产出一个可重定位的程序对象，而不调用 clang、链接器或 SDK。该对象定义了 `main`，意在通过外部原生链接成为程序本身。它不是宿主可调用的库；要那种接口请使用 `scriptc build --lib --profile ...`。

## ABI 与运行时约定

外部对象 ABI 是**实验性的**。它的 `scr_*` 函数与数据接口在 1.0 之前可能发生变化，因此使用者必须采用同一编译器安装所报告的、版本完全一致的 `@scriptc/runtime`。这比 semver 兼容性要求更严格。

该对象刻意把所选运行时的符号留作未定义。它还持有一个对 `scr_runtime_abi_v1` 的强引用，该符号由配套运行时定义。若把对象与带其他 ABI 标记的运行时链接，会在链接期因缺失带版本的符号而失败，不会留下潜在的运行期不兼容。

## 机器可读的链接信息

加上 `--print=native-link-info` 可以产出对象文件，并打印一份 JSON 文档，代替通常的路径行：

```bash
$ scriptc build main.ts --print=native-link-info -o app.o > link-info.json
```

`scriptc.native-link-info.v1` 文档报告以下内容：

- 目标三元组（target triple）、对象格式、架构、最低操作系统版本和重定位模型；
- `main` 入口与带版本的运行时 ABI 标记；
- 配套安装的 `@scriptc/runtime` 源码包根目录与精确的源码集、包含路径、宏定义，以及由程序选定的编译标志；
- 按顺序排列的程序、FFI、运行时与 vendor 输入；以及
- 所需的系统库与 framework。

每个源码集内的路径都相对于 `runtime_pack.root`。FFI 库路径是按清单解析出的绝对输入。没有任何路径指向 scriptc 的私有构建缓存。这份外部配方保持基于源码，以便透明，并便于嵌入自定义工具链。普通的 scriptc 可执行文件则使用已安装的、带哈希的 `@scriptc/runtime-darwin-arm64` 目标文件包，只需要最终的 macOS SDK 和链接器。

## 以 C 编译器作为链接驱动

仓库中的 `examples/native-object` 目录是一个可运行的示例，包含一个 TypeScript 程序、一个 C FFI 函数，以及一个消费 JSON 配方的小脚本：

```bash
$ cd examples/native-object
$ clang -target arm64-apple-macosx14.0.0 -O2 -c native.c -o native.o
$ scriptc build main.ts --ffi ffi.json --print=native-link-info -o app.o > link-info.json
$ node link.mjs cc link-info.json app-cc
$ ./app-cc
42
```

该脚本演示的是 macOS 的外部链接：它编译每个报告的源码集，并且只把文档中的链接输入和系统库交给 clang。`--emit=obj` 本身仍然不调用 clang；这里的编译器调用属于外部的运行时构建。Linux 对象需要目标的 glibc 或 musl 链接器/sysroot；Windows MSVC 对象需要 Windows SDK/MSVC CRT；WASI 对象需要 Preview 1 链接器/sysroot。

## 直接调用 Apple 链接器

同一个示例在编译完报告的运行时源码集后，也可以直接调用 Apple 的 `ld`：

```bash
$ node link.mjs ld link-info.json app-ld
$ ./app-ld
42
```

这条路径向 `xcrun` 询问选定的 macOS SDK 和链接器，然后提供目标的最低操作系统版本、按顺序的每个对象/归档输入，以及每个报告的系统库。它精确地展示了代码生成的边界：scriptc 负责 `app.o`；外部工具链负责运行时编译与平台链接。

对外 FFI 声明在 clang 编译的 LLVM 路径与辅助程序生成的目标文件路径中保持同样的 C ABI。标量宽度、字符串/字节的指针加长度对，以及回调签名，都遵循[原生 FFI](/docs/ffi) 清单。
