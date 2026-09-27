---
title: "原生 FFI"
description: "通过严格的 JSON 清单，让静态编译的 TypeScript 直接调用 C ABI 符号"
group: "指南"
order: 4
source: "https://scriptc.dev/ffi"
---

出站 FFI 让静态编译的 TypeScript 直接调用 C ABI 符号。一份严格的 JSON 清单把一个仅含签名的 TypeScript 声明连接到一个原生符号，并提供在链接时解析该符号所需的归档或目标文件。边界处不存在运行时符号查找，也没有 JavaScript 引擎。

## 替换 Node-API 插件

Node-API 插件通过接收 `napi_env` 和 `napi_callback_info` 的回调来暴露 JavaScript 函数。要通过 FFI 使用它的原生操作，需要把该操作抽取为一个普通的 C ABI 函数。把这个函数构建为对象文件或静态归档，并在清单中绑定它的 C 签名。如果你同时还在发布 Node 插件，就把 Node-API 注册和 JavaScript 值转换保留在一个独立的包装层里。重命名 `.node` 文件，或链接一个仍在调用 `napi_*` 的归档，并不能消除它对 Node 的依赖。参见 [原生插件限制](/docs/limitations#原生插件)。

例如，插件客户端可能会这样调用一个小的数值辅助函数：

**addon-client.ts**

```ts
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const native = require("./native.node") as {
  scale(value: number): number;
};

console.log(native.scale(21));
```

用一个仅含签名的 TypeScript 声明和一次直接调用来替换插件导入与方法调用。该声明向类型检查器提供普通的源码级签名；它不会产出任何 JavaScript 函数体。

**main.ts**

```ts
declare function nativeScale(value: number): number;

console.log(nativeScale(21));
```

用相匹配的原生签名实现一个 C ABI 符号：

**native.c**

```c
double native_scale(double value) {
  return value * 2.0;
}
```

在 FFI 清单中绑定这两个名字。库路径相对于该文件解析。

**ffi.json**

```json
{
  "ffi_format": 1,
  "functions": [
    {
      "name": "nativeScale",
      "symbol": "native_scale",
      "params": ["f64"],
      "returns": "f64"
    }
  ],
  "libraries": ["./libnative.a"],
  "system_libraries": []
}
```

构建原生归档，然后把清单传给 scriptc：

```bash
$ clang -c native.c -o native.o
$ ar rcs libnative.a native.o
$ scriptc build main.ts --ffi ffi.json -o app
$ ./app
42
```

FFI 绑定仅适用于对该声明本身的直接调用。带函数体的函数、重载、泛型声明、形如 `const f = nativeScale` 的别名，或被局部变量遮蔽的名字，都不会静默地变成本地调用。

## ABI 类别

清单是原生 ABI 的权威依据。TypeScript 只有 `number` 一种数值类型，因此其声明无法区分 double 与整数宽度的参数。

| 清单类别 | TypeScript 类型 | C ABI 类型与行为 | 参数 | 返回值 |
| --- | --- | --- | --- | --- |
| `f64` | `number` | `double` | 是 | 是 |
| `bool` | `boolean` | `uint8_t`；输入为 0 或 1，任何非零返回值都变为 `true` | 是 | 是 |
| `u8` | `number` | `uint8_t`；输入使用 JavaScript 的取模转换 | 是 | 是 |
| `u32` | `number` | `uint32_t`；输入使用 `ToUint32` | 是 | 是 |
| `i32` | `number` | `int32_t`；输入使用 `ToInt32` | 是 | 是 |
| `cstring` | `string` | `const char *`；仅作回调入参，经有损 UTF-8 解码复制 | 仅回调（格式 3 至 4） | 否 |
| `string` | `string` | `const uint8_t *, size_t`；UTF-8 字节，带长度定界 | 是；格式 3 至 4 中可作回调入参 | 否 |
| `bytes` | `Uint8Array` 或 `Buffer` | `const uint8_t *, size_t`；原始字节，带长度定界 | 是；格式 3 至 4 中可作回调入参 | 否 |
| `void` | `void` | `void` | 否 | 是 |

对于普通的出站参数，字符串与字节指针仅在调用期间借用。原生代码不得修改、释放或保留它们。字符串可能包含内嵌的 NUL 字节，因此必须始终使用传入的长度；空区间可能带有空指针。当前格式刻意不支持指针、字符串或字节返回值，因为这些返回需要一个明确的归属权与分配器约定。

对于 C++，用 `extern "C"` 导出符号，使其保留清单中未修饰的 C 名字。

对于操作系统辅助功能，也要把系统调用包装成固定签名的 C 函数。例如，Linux 的可变参数 `prctl` 需要一个包装函数来提供它的操作码与尾随参数。返回 C `int32_t` 的包装函数使用清单的 `i32` 返回类别与 TypeScript 的 `number`；在使用该值之前，先在 TypeScript 中检查它的错误结果。针对与 scriptc 二进制相同的目标来构建对象文件或归档。

## 回调与上下文指针

格式 2 增加了调用作用域的 C 函数指针参数。它把函数指针与不透明上下文描述为相互独立的 ABI 条目，并放在各自的实际位置上，与 C、Rust 的 `extern "C" fn` 加 `*mut c_void`、以及 Zig 的 `*const fn (...) callconv(.c)` 加 `*anyopaque` 所采用的模型一致。

例如，这个 C 函数第一个参数是回调，第二个是数值，最后是它的上下文。回调自身在最后接收上下文：

**native.c**

```c
typedef double (*map_callback)(double value, void *context);

double native_map(map_callback callback, double value, void *context) {
  return callback(value, context);
}
```

TypeScript 声明只包含源码层面的值。上下文条目由编译器提供，因此 TypeScript 里没有上下文参数：

**main.ts**

```ts
declare function nativeMap(
  callback: (value: number) => number,
  value: number,
): number;

const offset = 7;
console.log(nativeMap((value) => value + offset, 5));
```

回调 id 把两个独立定位的上下文条目关联起来。两处位置都是显式的；不假定相邻关系，也不假定惯用的参数顺序。

**ffi.json**

```json
{
  "ffi_format": 2,
  "functions": [
    {
      "name": "nativeMap",
      "symbol": "native_map",
      "params": [
        {
          "callback": {
            "id": "map",
            "params": ["f64", { "context": "map" }],
            "returns": "f64",
            "lifetime": "call"
          }
        },
        "f64",
        { "context": "map" }
      ],
      "returns": "f64"
    }
  ],
  "libraries": ["./libnative.a"]
}
```

一个回调描述符消耗一个 TypeScript 函数参数和一个原生函数指针槽位。一个上下文条目不消耗 TypeScript 参数，消耗一个原生 `void *` 槽位。格式 2 至 5 接受 `f64`、`bool`、`u8`、`u32` 和 `i32` 回调参数，外加至多一个上下文条目。格式 3 至 5 还额外接受 `cstring`、`string` 和 `bytes`；回调返回值仍是标量或 `void`。

格式 3 中携带字符串的回调参数会在闭包运行之前复制原生数据。`cstring` 读取一个非空、以 NUL 结尾的 `const char *`。`string` 和 `bytes` 各消耗一个 `const uint8_t *, size_t` 对；只有当长度为零时，空指针才有效。文本按 UTF-8 解码，格式错误的序列替换为 U+FFFD，与 `Buffer.toString("utf8")` 的行为一致。得到的字符串或 `Uint8Array` 是新归 scriptc 所有的存储，因此闭包可以保留它，而不依赖原生缓冲区的生命周期。意外的空 `cstring`，或指针为空但长度非空的区间，会在边界处触发 trap，而不是被当作空值处理。

对于没有 userdata 的原始调用作用域 C 回调类型，从两个参数列表中都省略上下文条目。scriptc 会在原生调用前后把该闭包安装到一个绑定专属的线程局部槽位中，因此捕获变量与嵌套调用仍然可用。

格式 4 增加了 `lifetime: "retained"`，用于那些存储回调并在之后的 FFI 调用中触发它的同线程原生 API。注册会钉住闭包及其捕获变量。成对的 release 绑定会把同一个蹦床（trampoline）与闭包上下文传回原生代码，然后在原生调用返回之后解除一个匹配注册的钉住状态：

**main.ts**

```ts
declare function timerAdd(interval: number, tick: () => void): void;
declare function timerRemove(tick: () => void): void;

const tick = () => console.log("tick");
timerAdd(100, tick);
// A later native pump call may invoke tick here.
timerRemove(tick);
```

**ffi.json**

```json
{
  "ffi_format": 4,
  "functions": [
    {
      "name": "timerAdd",
      "symbol": "timer_add",
      "params": [
        "u32",
        {
          "callback": {
            "id": "tick",
            "params": [{ "context": "tick" }],
            "returns": "void",
            "lifetime": "retained"
          }
        },
        { "context": "tick" }
      ],
      "returns": "void"
    },
    {
      "name": "timerRemove",
      "symbol": "timer_remove",
      "params": [
        { "callback": { "release": "timerAdd:tick" } },
        { "context": "timerAdd:tick" }
      ],
      "returns": "void"
    }
  ]
}
```

release 实参必须就是注册时使用的那个函数值。指向带上下文描述符的注册是计数的：同一个闭包注册两次就需要释放两次。原始描述符的槽位则是替换语义：每次 set 调用都会取代前一个注册，包括传入的正是已注册闭包的情况，因此该描述符任何时刻恰好只有一个待处理的 release。释放一个未注册的值会触发 trap，因为原生代码可能仍持有原指针；trap 在原生 release 调用运行之前触发，所以原生代码永远不会观察到无效的释放。在 retained 调用点，回调的函数类型必须完全一致；隐式包装会创建不同的指针，使 release 的身份判定不再可靠。把内联函数字面量作为 release 实参会因同样的原因被拒绝：它每次求值都会创建一个新闭包，一个没有任何注册持有的指针；请传入注册时使用的那个具名值。注册内联字面量仍然合法；只是这样的注册是永久的，会在退出清理时被丢弃。单个绑定不能对同一个描述符既注册又释放：清单加载器会拒绝一个 `release`，如果它指向的目标是同一函数参数列表中声明的 retained 回调，因为一次调用内先注册再释放的顺序会让调用前的 release 校验失效。

带上下文的描述符支持多个并发闭包。原始的 retained 描述符没有上下文指针，因此只有一个进程全局、带替换语义的槽位：前一个注册会保持活跃并继续派发，直到执行替换的 set 调用返回（一个在替换中途 flush 旧回调的原生 setter 仍能触达旧闭包），随后它被释放，槽位提交给新闭包。脚本线程的 retained 注册不会让事件循环保活；格式 5 的外部线程注册会。进程退出时，`process` 的 `'exit'` 监听器最先运行，它们在每条退出路径上仍可以释放注册或驱动脚本线程回调。事件循环停止时，外部投递会被解除武装，因此迟到的原生投递会被静默丢弃。在会运行 atexit 处理器的退出路径上，运行时随后会丢弃剩余的注册并解除原始槽位的武装；`process.exit()` 在其监听器之后立即终止，跳过那次清扫，把剩余注册留给操作系统处理。清理之后的原始槽位调用会触发 trap，而不是访问已释放的闭包。带上下文的注册没有可解除武装的槽位：一旦清理释放了闭包，它的蹦床和上下文指针就会悬垂，因此原生代码不得在退出之后调用它；一个可能在自己的退出路径上触发的库，应当通过 `process` 的 `'exit'` 监听器释放它的注册。

retained 的身份判定以声明它的绑定为作用域。每个 retained 回调参数都是它自己的描述符：`<binding>:<callback-id>` 这对名字对应一份注册台账、一个生成的蹦床，以及（对原始描述符而言）一个槽位；release 绑定只校验并解除那些经由它的 `release` 引用所指向的绑定做出的注册。两个存储到同一原生状态的绑定（例如针对同一个原生槽位的普通 setter，和替换时 flush 的 setter）因而是相互独立的描述符，会传给原生代码两个不同的函数指针。同一个函数值经两个绑定分别注册，再只经由其中一个释放，是不可靠的：release 在自己描述符的台账里解除钉住，但原生代码把存储的指针与另一个描述符的蹦床比较，于是存活的那个注册保持武装并继续派发；没有任何 trap，回调在程序自认为已释放之后仍会持续触发。同一时刻，一个函数值相对于某一个原生注册点只能通过恰好一个绑定保持注册，并通过该绑定的成对 release 释放。

格式 5 为那些从自己的线程调用回调的库，在 retained 且带上下文的回调描述符上增加了 `invoke: "foreign"`：

**ffi.json**

```json
{
  "ffi_format": 5,
  "functions": [
    {
      "name": "timerAdd",
      "symbol": "timer_add",
      "params": [
        "u32",
        {
          "callback": {
            "id": "tick",
            "params": ["cstring", { "context": "tick" }],
            "returns": "void",
            "lifetime": "retained",
            "invoke": "foreign"
          }
        },
        { "context": "tick" }
      ],
      "returns": "void"
    }
  ]
}
```

原生蹦床从不执行脚本代码。它把标量值与原生的字符串/字节内存复制到普通的暂存存储中，投递给进程的事件循环，然后立即返回，哪怕原生代码恰好是在脚本线程上调用它也一样。事件循环每轮只派发一次调用，按入队顺序先进先出，并与微任务和定时器交错。存活的外部线程注册会被 ref：它们让事件循环保持存活，直到成对的 release 绑定运行。回调可以释放自己；已经入队的投递仍然有效，并会在其闭包钉住被解除之前排空。抛出的异常遵循普通定时器回调的行为，除非周围的循环派发语义捕获它们，否则就是未捕获异常。

外部线程投递刻意采用即发即弃的方式。它要求 `lifetime: "retained"`、`returns: "void"` 和一个上下文条目。带返回值的 foreign 回调将不得不让库线程阻塞在脚本循环上，因容易死锁而被拒绝。投递至少需要一轮循环，不适合音频 DSP 这类实时工作。在原生线程上直接执行脚本闭包永久不受支持，因为引用计数、异常单元和纤程都是线程限定的。可解引用的结构体回调参数也不受支持；当 API 允许时，请改用带存取函数的不透明原生句柄。

如果脚本线程回调抛出异常，适配器会向原生代码返回零（或 `void`），并在异常挂起期间抑制后续的脚本回调执行。当外层原生函数返回时，原始异常通过 scriptc 普通的可捕获展开路径恢复传播。回调返回与外层函数返回之间执行的原生工作不会回滚。foreign 回调的原生蹦床在其闭包运行之前就已经返回；因此其抛出遵循的是事件循环回调的语义。

## 清单字段

- `ffi_format`：必填。格式 `1` 支持值参数；格式 `2` 保留这些参数并加入回调/上下文条目；格式 `3` 加入复制式（copy-in）的 `cstring`、字符串区间和字节区间回调参数；格式 `4` 加入 retained 注册与 release 引用；格式 `5` 加入被参数转换（marshalling）到事件循环的 retained 外部线程回调。
- `functions`：必填数组。每个条目恰好包含 `name`、`symbol`、`params` 和 `returns`。绑定名与符号必须唯一。回调 id 必须在单个函数内唯一，并且每个 context 必须恰好匹配一个回调或 release。release 引用同一清单中的一个 retained `<binding>:<callback-id>`，并继承它的回调 ABI。
- `libraries`：归档或对象路径的可选数组。相对路径从清单所在目录解析，并在链接时追加在生成的程序之后。
- `system_libraries`：可选的链接器中立库名数组。例如，`["m"]` 会生成为 `-lm`。

未知字段、无效的 ABI 类别、重复名字以及签名不匹配，都会让构建失败并给出 `SC5xxx` 诊断信息。同一份清单也可以传给 `scriptc coverage`，让原生调用点计为静态编译。

## 边界规则与当前限制

- 原生调用是同步的，且必须正常返回。不要让 C++ 异常或 `longjmp` 跨越边界展开。

- 原生代码处于 scriptc 的异常、引用计数与 sanitizer 约定之外。一个坏指针或不匹配的 C 签名仍然可能破坏进程。

- `invoke` 默认为 `"script-thread"`。格式 5 的 foreign 回调是异步的、返回 `void`、带上下文、需要显式释放，且不具备实时能力；在外部线程上直接执行脚本不受支持。

- 目前没有可变参数调用、按值传递的结构体参数、带归属权的指针返回值，也没有运行时 `dlopen`/`dlsym` 句柄。

- 归档或对象必须与构建目标匹配。交叉编译不会转换原生输入。

- 出站 FFI 目前仅可用于可执行文件构建，不支持 `scriptc build --lib`。
