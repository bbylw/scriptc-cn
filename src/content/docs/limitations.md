---
title: "限制"
description: "scriptc 静态编译不支持的边界、设计层面的行为差异与各目标的限制"
group: "参考"
order: 3
source: "https://scriptc.dev/limitations"
---

诚实就是产品本身。静态层级的覆盖面很大但并不完整，还有少数行为与 Node 的差异是刻意设计的。本页是通俗说明；对你的代码而言，真正的答案是在你的程序上运行 `scriptc coverage`，它报告的每一个阻碍点都有明确的说明和编码。本页没有任何含糊之处：这里的内容要么是编译错误，要么是已记录在案、带编号的行为差异。

## 原生调试

使用 `--optimization=dev` 构建的可执行文件支持源码断点，以及针对静态编译的 TypeScript 和 JavaScript 的原生栈帧。LLVM 构建还会使用源码名称和词法作用域来描述源码局部变量、参数、被捕获的绑定和模块全局变量。数字和布尔值直接显示；字符串暴露其原生 `ScrStr` 布局，包括 UTF-8 的 `data` 和字节 `len`；带标签的联合暴露其 `tag` 和 `slot` 分支。其他堆值和前向捕获的标量绑定可能显示为不透明的原生指针。C 后端暴露生成的 C 名称和表示形式。TypeScript 表达式求值、JavaScript 对象格式化，以及对由动态引擎执行的代码进行单步调试均未实现。Release 构建和带 `--strip` 的构建会省略这些源码映射。macOS 使用由 Command Line Tools 的 `dsymutil` 生成的相邻 `.dSYM` 包。

## 尚不能编译的内容（截至目前）

这些问题会在编译期被拒绝，并给出 `SC` 编码、代码帧，通常还有改写提示。以下是你最可能遇到的问题的非穷举巡览：

**语言边界**

- 宽松的 `==`/`!=` 比较可以在静态表示的原始类型和原始类型联合操作数之间编译，包括 number/string/boolean/BigInt 的强制转换，以及 `x == null`/`x != null` 的空值惯用法。对象到原始类型的比较仍然受限，因为自定义的 `valueOf`/`toString` 方法可以执行任意代码；请先显式转换该对象。

- 块作用域和函数作用域的 `using` 与 `await using` 可以针对如下情形编译：静态表示的类、零参数的释放方法，以及受支持的 FileHandle、定时器、immediate、子进程和 readline 句柄。数组的 `for (using ... of ...)` 循环可以编译。顶层和 switch 子句中的声明、经由引擎持有的包值进行的释放，以及 `DisposableStack` 构造函数仍然受限；被捕获的 `SuppressedError` 会暴露其兼容 Node 的 `name` 和 `message`，但它的 `error` 与 `suppressed` 负载属性仍处于静态 catch 面之外。

- 带类型的异步生成器函数和方法可以编译，具备惰性执行、`await`、直接 `yield`、排队的 `.next()`/`.return()`/`.throw()` 请求以及 `for await`。`for await` 还可以消费 Node 的 `Readable` 流、Web 的 `ReadableStream` 值，以及静态表示的类的迭代器（其零参数 `next()` 返回一个 promise，解析为 `{ value, done? }` 记录）；突然结束会运行迭代器的清理逻辑，包括字面量的 `destroyOnReturn` 和 `preventCancel` 选项。异步 `yield*` 委托、存储起来的 Web/Node 迭代器句柄，以及其他结构化的异步迭代器对象仍然受限。`node:timers/promises` 的 `setInterval(delay, value)` 异步迭代器可以编译，但它的 AbortSignal 选项仍然受限。

- 泛型在目标可静态解析时进行单态化。剩余边界包括在另一个函数内部声明的泛型函数、泛型类表达式、基类依赖自身类型参数的泛型类，以及需要动态分派的泛型方法。

- 泛型函数值必须在使用处固定到一个具体签名，并且来自从不重新赋值的绑定；未固定或被重新绑定的值仍然受限。重载程序函数的不可变别名保留按调用的重载解析和函数同一性。带类型 rest 参数的函数是一等值：间接调用会把多余的实参打包进函数的类型化数组槽位。降级后的 `node:path` 函数（包括可选的 `basename` 和变长的 `join`/`resolve`）在 bare、POSIX 和 win32 模块中都是一等静态值；精确零参数的 `node:os` 函数以及 `querystring.escape`/`unescape` 同样是一等值。固定签名的文件系统函数 `existsSync`、`unlinkSync`、`chmodSync`、`chownSync`、`renameSync`、`closeSync`，以及 `node:fs/promises` 的 `unlink`、`chmod`、`rename` 函数也是一等值。带有影响行为的尾部实参的文件系统 API（包括写入器、open、目录创建/删除、元数据读取器和目录读取器）仍然仅限直接调用，以免函数宽度适配丢掉模式、标志、编码或选项。表格支撑的 Node 内置模块的其他不可变别名可以直接调用，但把它们逃逸出去仍然受限；`util.promisify` 对 `child_process.execFile` 和 utf8 的 `fs.readFile` 有编译期投影。

- 展开实参在其元数为静态时可以编译：非空固定元组会展平进固定签名，采用从左到右、只求值一次的语义；数组、Set 和静态表示的类可迭代对象会展开进类型化的 rest 参数。在 JavaScript 中，运行时长度的展开放入固定签名仍然走 checked-dynamic 或 island 路径，其他情况会收到编译期诊断信息。

- 对已编译的 ESM/TypeScript 模块和受支持的 Node 内置模块的字面量 `import()` 可以在不依赖动态引擎的情况下编译。求值仍然是惰性且延后到微任务的，会遵循顶层 `await`，重复导入共享同一个命名空间同一性，导出的可变绑定保持活跃，且对已编译模块命名空间调用 `Object.keys` 时使用 Node 的排序键顺序。计算得到的说明符、import 属性、CommonJS 命名空间合成，以及随产物分发的 JavaScript 包导入仍被明确限制，或需要 `--dynamic`。

**类型与形状**

- 任意精度的 `bigint` 值可以在静态下编译，覆盖字面量、算术和位运算符、比较、转换、数组、记录、类、闭包、联合、promise、Buffer 64 位读写以及 DataView 64 位访问。`BigInt64Array`/`BigUint64Array`、BigInt 文件系统统计、JSON 序列化、Map/Set 键，以及让 BigInt 穿过 `unknown`、`any` 或动态 island 仍然受限。

- **记录形状是精确的结构体。** 在期望 `{a}` 的地方传入 `{a, b}` 会得到 SC2002。在编译器确实接受严格字段子集流的地方，它会复制该记录，参见下方的设计差异。

- 联合边界：类联合上的同 ABI 方法以及数组分支联合上的 `map`/`forEach` 按运行时分支分派，共享或可合并的字段读取也可以编译。剩余边界包括没有共同分支 ABI 的操作（例如在 `string | string[]` 上读取 `u.length`，需要先收窄）、超出 re-tag 规则和 width 规则之外的联合到联合加宽，以及与数据分支并列的函数分支。（打印整个联合没有问题：`console.log(u)` 会按分支分派。）

- 注意 **元组推断**：`Promise.all([work(1), work(2)])` 会推断出元组类型，而元组边界（比如对元组调用 `.join`）是受限的。先给数组标注类型：

```ts
const jobs: Promise<number>[] = [work(1), work(2), work(3)];
const results = await Promise.all(jobs); // number[]，可编译
```

- `undefined` 和 `null` 既可以作为独立值编译，也可以作为联合分支编译。可选的记录字段和类字段可以编译，可选参数、默认参数和 rest 参数也可以编译。

**标准库**

- `EventEmitter` 对字面量事件名使用固定参数元组。当常量前缀或后缀能够证明计算得到的字符串名不可能命名 `error`、meta 事件或 stream 内部事件时，这些名字可以编译；这些调用会传入精确元数的 checked-dynamic 实参。不受限制的名字、symbol、可能触及内部事件的计算名，以及可能带有计算注册的名字的带类型 `listeners()`/`rawListeners()` 结果仍然受限。

- CommonJS 模块元数据（`module.id`、`filename`、`path`、`paths`、`loaded`、`isPreloading`、`parent`、`children`、`require.main`，以及只读的 `require.cache` 查找/枚举）可以原生编译。编译出的二进制有固定的模块图，所以缓存删除/重新加载、元数据写入、`module.paths` 变更和 `require.extensions` 仍是明确的拒绝项。

- `child_process.fork(modulePath, args?, options?)` 在 `modulePath` 能在构建期由 `new URL("./worker.ts", import.meta.url)` 或 `fileURLToPath(new URL("./worker.ts", import.meta.url))` 解析时编译，包括从不重新赋值的 `const` 别名和可静态解析的模板片段。worker 及其导入被嵌入可执行文件；原生二进制重新执行自身并只启动该 worker 模块。参数在 worker 中从 `process.argv[2]` 开始，其位置与 Node 一致，但存在下文所述的过程形状差异。默认的继承 stdio，以及带 `cwd`、`env`、`silent`、`windowsHide` 或 `[stdin, stdout, stderr, "ipc"]` 的内联选项对象可以编译。`execArgv` 会被接受但没有原生效果，因为运行时不会启动任何 Node 可执行文件或源码加载器。父进程侧的 `ChildProcess` 和子进程侧的 `process` channel 支持 `send(message, callback?)`、`connected`、`disconnect()`，以及针对 `"message"` 和 `"disconnect"` 的 `on`/`once`；消息监听器可以返回 `void` 或 `Promise<void>`。消息使用 Node 默认的换行分隔 JSON 序列化，因此它们的静态类型必须是可 JSON 字符串化的，或者是背后为受检 JSON 树的 `unknown`。`send()` 返回原生 channel 的反压状态，其回调稍后以 `null` 或 `Error` 运行，`disconnect()` 会同步改变 `connected`，早于任一侧稍后的 `"disconnect"` 事件。运行时取值的 worker 路径、自定义 `execPath`、高级序列化、转移的 socket/server、uid/gid、timeout/signal 选项以及其他 stdio 数组仍是明确的拒绝项。

- 类型检查器看到的是完整的标准库；只有受支持的表面可以编译。触达已声明但未降级的表面会得到 SC2020，提示中给出受支持的替代方案，例如正则 API 的部分内容（`re.exec`）、`Symbol`、静态构建中把 `globalThis` 当作值使用，以及超出已降级集合之外的数组/Map/Set 方法。

- `Date` 值支持零参数构造、一个 number/string 参数、存储与传递、`getTime`/`valueOf`、`toISOString`、本地和 UTC 日历取值器，以及 `getTimezoneOffset`。`Date.parse(dateString)` 接受一个字符串，使用与 `new Date(dateString).getTime()` 相同的有界解析器。带 Date 分支的联合、年/月字段构造函数、setter、同一性比较、会抛错的 `Date` 值以及本地化/字符串格式化器仍然受限；受支持的字符串语法在下文描述。

- `URL` 支持从一个绝对字符串构造，加上可在构建期解析的相对字面量和基于 `import.meta.url` 的模板，以及只读的 `protocol`、`origin`、`username`、`password`、`pathname`、`href`、`host`、`hostname`、`port`、`search` 和 `hash` 取值器。`searchParams` 仍是一个实时视图。运行时取值的 base 参数和 setter 仍然受限。

- `fs.openSync` 接受 `fs.constants.O_RDONLY`、`O_WRONLY`、`O_RDWR`、`O_CREAT`、`O_EXCL`、`O_NOFOLLOW`、`O_NONBLOCK`、`O_TRUNC` 和 `O_APPEND` 的内联按位 OR 表达式，可带可选的创建模式。计算得到的数值 flags 仍然受限，因为它们的位值因目标而异。`fstatSync`、`fchmodSync`、`fsyncSync` 和 `linkSync` 在直接调用点可以编译。在 Windows 上，带 `O_NOFOLLOW` 的数值 open 和 `fchmodSync` 会抛出 `ENOSYS`，因为 CRT 无法强制执行这些约定；需要它们的程序应使用 POSIX 目标。

- 在语句位置写入数值 `process.exitCode = value` 会设置隐式退出状态；无参数的 `process.exit()` 使用该状态。读取或重置 `process.exitCode`，以及把赋值用作值，仍然受限。

- Map 的键和 Set 的元素只能是字符串和数字；其他键类型受限。

**`any`/`unknown` 边界**

- 不带 `--dynamic` 的 `any` 是编译错误（SC2011）：请改用 `unknown` 加受检转换，或启用引擎。

- `any` 和 `unknown` 可以存在于局部变量、参数和返回值中，绝不能出现在类字段、数组元素或联合分支中（记录字段和元组字段可以持有 `unknown`）。程序类的实例可以穿过 `unknown` 并在其精确的静态类类型处恢复而不丢失同一性，受支持的原生句柄也是如此；JSON 形状的记录和数组保留下文描述的复制边界。

- 对 `unknown` 执行受支持表面（真值判断、`typeof` 收窄、属性访问、`+`、`switch`、`throw`）之外的操作，需要先做受检转换。

**类型表面**

scriptc 在它自己的类型世界中对你的程序做类型检查：标准的 `es2025` lib 加上它自己的环境声明。在列举出的位置，这些声明与标准 lib 或 `@types/node` 刻意不同，按实际可编译的内容来标注类型：`JSON.parse` 返回 `unknown`（而不是 `any`），Promise executor 的 reject 原因被固定为 `Error`。所以“能通过类型检查的程序”指的是 scriptc 的类型世界，在自己的 `tsc` 下干净的程序仍可能被引导到这里，但绝不会带着它无法复现的裸类型错误：收紧后的声明有第二次机会的预检（在该项目自己的类型世界中干净的程序可以通过，且受影响的站点会逐站得到带改写提示的诊断信息），而在随产物分发的回退声明缺少某个标准成员的降级（`console.table`、`console.time` 等）的地方，该成员仍会被声明，从而让调用落到 SC2020 并命名受支持的替代方案。`console.log`/`info`/`debug`/`error`/`warn` 本身接受 `unknown` 实参并按 Node 的 console 语义渲染：字符串原样输出，其他一切通过静态的 `util.inspect`。

对某个文件运行 `scriptc build` 以获得针对该程序的完整最新列表，编译器总是比本页更新。

## 设计层面的差异

除此之外，静态层级的程序产生的 stdout 与 Node 逐字节一致，退出码也相同。每一个已知差异都是刻意为之，并由差分测试套件钉住；以下是有实际影响的这些：

**类型化数组的越界访问仍然会触发硬陷阱。** 普通数组把空缺与真实存在的 `undefined` 值分开跟踪：缺失的下标读取和空的 `pop()`/`shift()` 返回 `undefined`，下标写入可以让数组增长，长度增长会创建空缺。类型化数组的下标访问保留其独立的边界检查；非法的类型化数组下标会中止进程，而不是返回 `undefined`。

**运行时陷阱不可捕获。** 用户 `throw` 完全可捕获，而 Node 建模为异常的运行失败（JSON 解析错误、受检转换失败、fs 错误、正则错误）会抛出真实的错误对象。剩余的硬陷阱（包括类型化数组越界访问）会中止进程。

**对动态数据撒谎的转换会抛错，而不是损坏内存。** 这是头号差异，也是重点所在。`JSON.parse(s) as Config` 在数据不匹配时会抛出可捕获的错误并指名出错路径（`expected number at $.port, got string`），而 JS 会悄悄交给你垃圾数据。

**结构化宽度子类型会复制。** 流入严格字段子集形状的记录会被复制而不是共享引用：通过更窄的引用进行的修改对原对象不可见。在动态边界处采用同样立场：值通过复制穿越，绝不通过引用穿越。

**`Object.keys`/`values`/`entries` 和 `JSON.stringify` 报告的是记录的声明顺序**，而不是每个对象的插入顺序。只要对象按声明顺序构建（绝大多数常见情况），就与 Node 相同。

**字符串以 UTF-8 存储。** 通过 `.length` 和字符串方法不可见（这些方法按 UTF-16 语义计算），只有关系比较（`<`、`>`）例外，它使用码点顺序；拆分代理对的操作会产生 U+FFFD。

**日期解析和时区数据是有界的。** 单字符串构造函数和 `Date.parse(dateString)` 接受 ECMAScript 的仅日期形式、带显式 `Z` 或数值偏移的日期时间，以及受支持的 X509 表面返回的 GMT 证书有效期字符串；其他 V8 特有形式和无偏移的本地日期时间会分别返回 Invalid Date 或 `NaN`。本地日历取值器使用操作系统的时区数据库，因此当它与 Node 的时区数据不一致时，历史结果可能有差异。当某个平台的日历 API 无法表示一个本来合法的极端年份时，scriptc 会在 400 年格里高利历周期内的日历等价年份上查询其 zone 规则。

**内存使用引用计数。** 无环的值确定性释放；引用环在确定的收集点被回收，而不是由并发 GC 回收。跨越静态/island 边界的环双方都无法回收。

**外部原生回调是异步的，且不具备实时能力。** FFI 格式 5 接受由库拥有的线程调用的、保留的、带上下文的 `void` 回调，但原生跳板只复制参数并排队工作。闭包至少在 script 事件循环的下一轮运行。返回值的 foreign 回调和在库线程上直接执行都被拒绝：等待循环容易死锁，而 scriptc 的引用计数和异常状态是线程限定的。

**进程形状**：`process.argv[0]` 是 `"scriptc"`，`argv[1]` 是二进制的路径（各位置与 Node 对齐；`argv[2]` 起是你的参数）。未捕获异常的 stderr 行输出 `Uncaught <value>`，而不是 Node 的栈追踪块（退出码和抛出前的 stdout 相同）。运行时错误带有 `message` 和 Node 的 `code`，但不带 `errno`/`syscall`/`path`。

**`sort` 和 `toSorted` 中比较器的调用序列不同**（scriptc 使用稳定的自底向上归并排序，而 V8 使用 TimSort）。对一致的比较器，排序结果逐字节相同。有序输入使用线性次数的比较器调用，但即使每个边界都已有序，归并缓冲的移动仍是 O(n log n)。**`localeCompare` 比较码元**，而不是 ICU 排序规则。

## 动态层级限制

- **宿主全局对象：** 在 TypeScript 的 `--dynamic` 构建中，`const host: any = globalThis` 或 `(globalThis as any).TextDecoder` 访问的是 island 的全局对象。它的 Node 全局对象使用 island 的 shim，即使没有嵌入 npm 包也是如此；这些 shim 也有各自的限制（例如 `TextDecoder` 只支持 UTF-8 标签），而 `fetch` 之类的可选能力只有在构建链接了它们的桥时才会安装。

- **这个 island 是 quickjs-ng，不是 V8**：行为正确，但对 CPU 密集的依赖代码更慢。收益在于启动、体积、内存和部署形态。

- **island 的 Node 内置模块是 shim**：它们是重新实现，按内置模块在覆盖率报告中逐项报告，而不是真正的模块。

- **island 的微任务交错**：静态纤程先排空，然后引擎的任务在循环静默时运行。与包 promise 竞争的静态 `await` 会按有文档记录的确定性顺序完成，可能与 Node 的交错不同。

- **嵌入的 ESM 包中的顶层 `await`** 尚不支持。它在你程序自己的 ESM 图中可以编译，在通过 `--npm-static` 编译的 npm 包中也可以；剩下的限制是运行在 `--dynamic` island 内部的包代码。

- **`--npm-static` 和 `--provenance-sources` 是实验性的**，成熟度说明见 [npm Dependencies](/docs/dependencies)。

## 原生插件

Node-API（N-API）和 V8 `.node` 插件需要 Node 的插件运行时，scriptc 在静态构建和 `--dynamic` 构建中都不嵌入它。对本地插件的直接 `createRequire` 调用会在编译期被拒绝。嵌入的 npm 包在尝试加载插件时会收到可捕获的 `ERR_DLOPEN_FAILED`，让带有 JavaScript 回退的包可以选择回退方案。

使用[原生 FFI](/docs/ffi#替换-node-api-插件)，通过从对象文件或静态归档链接的普通 C ABI 函数来调用底层原生操作。该指南包含一个小型 Node-API 辅助程序的完整替换方案。

## WASI 目标限制

生产环境的 `wasm32-wasi` 目标通过 LLVM 支持完整的可执行语言层级：async/await、promise、生成器、定时器和其他可移植的事件循环工作、stdin/readline、文件系统回调与 promise，以及 `--dynamic` island。可移植的 WASI Preview 1 没有 socket、进程生成、OS 信号、网络接口或文件系统通知能力，因此 networking/fetch、子进程、信号 API、`os.networkInterfaces()` 和 `fs.watch` 会在链接前被 `SC3002` 拒绝。`--sanitize`、原生 FFI 和库模式的归档构建也不可用。文件系统访问受宿主 preopens 的限制；`scriptc run` 会暴露当前工作目录和 `/tmp`。构建与运行细节见 [Platform Support](/docs/platforms)。

## 工具链缺口

- `scriptc run` 不会把多余的 CLI 参数转发给程序：请改用 `build` 并直接调用二进制。

- 原生 FFI 是直接、由清单声明的 C ABI 链接表面。格式 2 至 5 覆盖调用作用域回调、复制的字符串/字节回调参数、显式释放的保留回调，以及异步的 foreign 线程投递。变长调用、按值的 struct、拥有的指针/字符串/字节返回值、运行时的动态库加载和库模式构建仍然不支持。参见 [Native FFI](/docs/ffi)。

- 数字在所有位置都是与 JS 精确一致的 f64。整数推断和所有权分析（系统语言的性能上限）属于路线图，尚未交付。
