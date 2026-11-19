// 依赖清单的判据：哪些「看起来没 import」其实必须保留。
//
// 这个文件是工具**唯一一条规矩的 home**——扫描与报告只按这里的规则走，别在别处再写一份白名单。
//
// 语义约定：`keepReason()` 返回**必须保留**的理由；返回 `undefined` 才表示「能删」。

/** 一个包的源码扫描结果。 */
export interface Scan {
  /** 源码里出现过的裸说明符对应的包名。 */
  readonly used: ReadonlySet<string>;
  /** 源码里出现过的裸说明符原文（排错用：`@morlay/x/server` 与 `@morlay/x` 都留）。 */
  readonly specifiers: ReadonlySet<string>;
}

/** 从裸说明符取包名：`@scope/name/sub` → `@scope/name`，`name/sub` → `name`。 */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** 是不是裸说明符（相对路径、绝对路径、`node:` 内建、`#` 导入映射都不算）。 */
export function isBareSpecifier(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith(".") || value.startsWith("/") || value.startsWith("#")) return false;
  if (value.startsWith("node:")) return false;
  if (value.includes("://")) return false;
  return true;
}

/**
 * 这份依赖**必须保留**的理由；能删就返回 `undefined`。
 *
 * 五条判据各自对应一类「AST 里看不到但确实需要」的依赖。想放宽其中某条，
 * 先改这里再改 `src/__tests__/rules.spec.ts`——测试按这些理由逐条断言。
 */
export function keepReason(input: {
  /** 依赖名（`package.json` 里的键）。 */
  readonly name: string;
  /** 本包自己的包名。 */
  readonly self: string;
  /** 源码里用到的包名。 */
  readonly used: ReadonlySet<string>;
  /** `scripts` 里的全部命令文本（拼在一起）。 */
  readonly scripts: string;
  /**
   * 清单里**除三份依赖清单之外**的全部文本（`exports` / `files` / `dsh` / `remotes` / …）。
   *
   * 这些字段会用**字符串**点名包：`AppEnv.remotes` 列 `dsh-llm`、`dsh.desktop` 列图标、出口生成器
   * 按 `files` 读——AST 里一个 import 都没有，但删了对应依赖装配就散。
   */
  readonly manifest: string;
  /** 同一份清单里的其它依赖名（判 `@types/x` 用）。 */
  readonly siblings: ReadonlySet<string>;
}): string | undefined {
  const { name, self, used, scripts, manifest, siblings } = input;

  // ① 源码里 import 了：这就是本工具要保的那一类。
  if (used.has(name)) return "源码里 import 了";

  // ② 自引用：包把自己的名字写进 devDependencies，是为让**包内测试走包名**（守 exports）。
  //    只有真的按包名 import 了自己才算（上面的 ① 已经覆盖）；**光声明不 import 就是死依赖**。
  if (name === self) {
    return used.has(self) ? "自引用（包内测试走包名，守 exports）" : undefined;
  }

  // ③ `@types/x`：实际消费方是 tsconfig 的 `types` 与编译器的解析链，AST 里看不到。
  //    目标包还在（源码用着，或还挂在依赖清单里）时这份类型才有意义；目标包已经没了，这份类型
  //    就是上一轮删剩的（删 `js-yaml` 之后 `@types/js-yaml` 该跟着走）。
  //    `@types/node` 不是「某个包的类型」而是 Node 内置类型面（tsconfig 的 `types: ["node"]`），永远保。
  if (name.startsWith("@types/")) {
    const target = name.slice("@types/".length);
    if (target === "node")
      return "@types：node 是 Node 内置类型面（tsconfig 的 types 读，AST 不可见）";
    if (used.has(target) || siblings.has(target)) return `@types：${target} 在用`;
    return undefined;
  }

  // ④ scripts 里点名：构建链与检查工具（`tsdown` / `oxlint` / `vitest`）在命令里按名字出现，
  //    AST 里没有 import。
  const bare = name.replace(/^@[^/]+\//u, "");
  if (scripts.includes(name) || scripts.includes(bare)) return "scripts 里点名";

  // ⑤ 清单的其它字段里点名：`remotes` 清单、`dsh.desktop`、`exports` / `files` 这类字段按**字符串**
  //    引用包（`AppEnv.remotes` 列 `dsh-llm` → 运行时动态 import），删了装配就散。
  //
  //    按裸名（去掉 `@scope/`）也要匹配：清单里写的是 `dsh-llm`、依赖键是 `@deepseek-ai/dsh-llm`，
  //    两边对不上但指的是同一个包。裸名要够长（≥ 6）才匹配，否则 `vite` / `react` 这种短名会在
  //    任意文本里误命中（例如某个 `files` 路径里含 `react` 片段）。
  if (manifest.includes(name)) return "清单其它字段里点名";
  if (bare.length >= 6 && manifest.includes(bare)) return "清单其它字段里点名";

  // ⑥ 生成物里才出现的运行时：rolldown 给装饰器注入的 helper 来自 `@oxc-project/runtime`
  //    （`helpers/decorate`），AST 里一个 import 都没有——它的消费方是**产物**，不是源码。
  //    声明它的地方只有一个：`packages/boot/dsh-oxc-node`（本仓库的 TS 运行时入口，
  //    `oxc-transform` 与它必须同版本线）。框架包不声明它：那是 node 侧的补强，不进运行时契约。
  if (name === "@oxc-project/runtime") return "生成物运行时（rolldown 注入的 helper，AST 不可见）";

  return undefined;
}

// ── 类型纪律的两条判据（判据 6 契约面值边 / 判据 7 双断言白名单）
//
// 见 `packages/zephyr/zephyr/.agents/designs/20261113-类型约束.md`。**面边界与边界桥白名单只在这里定义**：
// 扫描与报告都按这里的规则走，别在别处再写一份。

/** 契约 / 端点面：`src/{contract,endpoint}/**`——两端共用，值边会把宿主行拖进浏览器。 */
export function isContractOrEndpointFace(file: string): boolean {
  return /(^|[\\/])src[\\/](contract|endpoint)[\\/]/u.test(file);
}

/**
 * 是不是测试代码（`__tests__/**`）。
 *
 * 双断言判据按它分成**两条**：生产面是硬门禁（`"double-assertion"`），测试域只降不升
 * （`"double-assertion-test"`）。两边各记各的基线、各报各的数——测试域的存量比生产面大一个量级，
 * 合成一条会把生产面的增量淹掉。
 *
 * **边界桥白名单对测试域同样适用**（`bridgeReason()` 先判）：另一头是外部形状的断言不因为它在
 * 测试里就变成正当的。测试只在面边界 / 唯一化 / 扩展边界这几条上豁免（那里装整个应用是正当的）。
 */
export function isTestPath(file: string): boolean {
  return /(^|[\\/])__tests__[\\/]/u.test(file);
}

/**
 * 边界桥白名单：`as unknown as` 唯一合法的地方。返回理由；`undefined` 表示不在白名单。
 *
 * 判据是「桥的另一头是什么**外部形状**」，不是「这个文件里断言多」。四类：装配入口（cordis Context）、
 * cordis 兼容桥、rdb 行映射（SQL 行）、旧格式落盘（v3 及更早的 JSON）。**域内**的断言一律不白名单——
 * `rdb/log/repair.ts` 的另一头是域对象，不是外部形状，所以它不在表里。
 */
const BRIDGES: readonly { readonly match: RegExp; readonly reason: string }[] = [
  { match: /(^|[\\/])src[\\/]bootstrap\.ts$/u, reason: "装配入口：另一头是 cordis Context" },
  {
    match: /(^|[\\/])src[\\/]compat[\\/]from-cordis\.ts$/u,
    reason: "cordis 兼容桥：上游 ctx / 服务 → 本仓契约",
  },
  {
    // agent scope 的事件补发：要 cordis Context 的 `events` / `effect`，本仓的 `Context` 面没有它们。
    match: /(^|[\\/])src[\\/]agent-session-events\.service\.ts$/u,
    reason: "agent scope 的事件派发：另一头是 cordis Context",
  },
  {
    match: /(^|[\\/])src[\\/]rdb[\\/].*(rows|read-path|backend|log-import|migration)[^\\/]*\.ts$/u,
    reason: "rdb 行映射：另一头是 SQL 行（列值 → 域对象）",
  },
  {
    // 只覆盖 desktop 壳的这个文件：Electron 只在**它的**进程里存在，别包的 `src/app.ts` 不是这个桥。
    match: /(^|[\\/])zephyr-desktop-shell[\\/]src[\\/]app\.ts$/u,
    reason: "Electron 边界桥：Electron 内置模块、进程对象与 IPC 参数都没有本仓类型面",
  },
  {
    // 本仓 `Context` ↔ cordis `Context` 的转换点：zephyr 的 `Context` 是 cordis `Context` 的**扩展面**，
    // 在 `exactOptionalPropertyTypes` 下"补得更多"反而不可赋值（同一成员两边一个可选、一个必有）。
    // 另一头是 cordis 的 `Context` 类型（上游 `ClientSessions` 的构造与 `scopeOf` / `sessionOf` 的入参），
    // 运行期是同一个对象；同一条边在 zephyr 的 `compat/to-cordis.ts` / `from-cordis.ts` 里也各断言一次，
    // 那两处归 zephyr 域。只在**这一个文件**里有这一条边，所以只白名单这个文件。
    match: /(^|[\\/])dsh-conversation[\\/]src[\\/]ui[\\/]upstream-context\.ts$/u,
    reason:
      "cordis Context 兼容桥：本仓 Context / SessionScope → 上游 cordis Context（运行期同一对象）",
  },
  {
    // 第三方声明面比运行期**窄**的两处，收在一个 testing 文件里：用例仍按运行期形态写，
    // 收窄只在 `schemastery-limits.ts` 一处（**用例里那些「局部替身」的断言不在这里放行**）。
    // 另一头是 vendor 里的第三方类型声明：`@deepseek-ai/schemastery` 的 `Schema.description()` 只写
    // `string`（运行期与我们的 `FieldMeta.description` 都收本地化字典），`.default(value)` 的形参
    // 不收 `null`（而 schema 里「默认空」就写成 `null`）。vendor 只读，改了上游同步就丢。
    match:
      /(^|[\\/])zephyr-ui[\\/]src[\\/]client[\\/]schema-form[\\/]testing[\\/]schemastery-limits\.ts$/u,
    reason:
      "schemastery 声明面比运行期窄：`description()` 只写 string（运行期收字典）、`default()` 不收 null",
  },
  {
    // 旧格式落盘：`better-session` 的读视图要把**历史 JSON 产物**（v3 及更早，字段名/形状与当前不同）
    // 读成当前的 `SessionHeader` / `SessionEvent[]`。另一头是**盘上已经存在的字节**，不是本仓能重写的域对象。
    // 为什么不能靠迁移解决：迁移链（`@deepseek-ai/dsh-session-format-*`）只在**导入/升级**时跑，且要求整份
    // 产物过严格校验——读路径要处理的是「不保证过校验的旧文件」（用户机器上的存量），只能就地按结构收窄。
    match: /(^|[\\/])src[\\/]data[\\/]store[\\/]read-view[\\/]legacy\.ts$/u,
    reason:
      "旧格式落盘：另一头是 v3 及更早的 JSON 产物（旧字段/旧形状 → 当前 SessionHeader / SessionEvent[]）",
  },
  {
    // 本仓 `Context` ↔ cordis `Context` 的**类型面**差异：`@deepseek-ai/cordis` 与
    // `vendor/deepseek-harness/vendor/cordis` 在 tsc program 里是两个模块实例，前者缺
    // `events.ts` / `fiber.ts` 的模块增强（`set` / `accessor` / `mixin` / `fiber` 那 9 个成员）。
    // 另一头是上游 `Context` 的类型；运行期是同一个对象。只在 spec 里做一次收窄（生产侧归 zephyr 域）。
    // **精确到文件**，不用 `src/__tests__/**` 通配：那条通配会把全仓所有测试文件的 `as unknown as`
    // 一起放行（review 抓到过——测试域基线 168→102 的降幅大部分是它吞掉的，不是真收干净）。
    // 只有这两个文件里那 5 处是真的「本仓 `Context` ↔ cordis `Context`」的类型面差异。
    match:
      /(^|[/])zephyr[/]zephyr[/]src[/](__tests__[/]scoped-rows|compat[/]__tests__[/]from-cordis)\.spec\.ts$/u,
    reason: "cordis Context 的两个模块实例：类型面差异（增强未加载），运行期同一对象",
  },
  {
    // 契约的返回面是**两半共用上界**（`Reply<T> = T | RemoteResultWire<T>`：宿主回裸值、客户端回 `Remote`
    // 封装），而上游的 `ClientWorkspaceModel` 只认客户端那一半。这一处是两者相接的唯一点。
    match: /(^|[/])dsh-workspace[/]src[/]ui[/]workspace-controller\.service\.ts$/u,
    reason: "契约上界 → 客户端形态：`Reply<T>` 收窄到 `RemoteResult`（两半共用的声明只能写上界）",
  },
];

/**
 * 这条 `as unknown as` 所在文件是不是边界桥。
 * @param file 文件路径（可含任意前缀：只匹配 `src/` 之后那一段）。
 * @returns 桥的理由；不在白名单则 `undefined`。
 */
export function bridgeReason(file: string): string | undefined {
  for (const bridge of BRIDGES) if (bridge.match.test(file)) return bridge.reason;
  return undefined;
}

/** 上游包根说明符：`@deepseek-ai/<name>`（带子路径的不算——判据只看包根）。 */
export function isUpstreamPackageRoot(specifier: string): boolean {
  return /^@deepseek-ai\/[^/]+$/u.test(specifier);
}

/**
 * 契约面允许的上游**值边**白名单（`import type` / `export type` 在调用方就已排除，不进这里）。
 *
 * 现在是**空的**：判据 6 的 56 条一条都还没收敛，先出报告。要放行哪条先在这里登记说明符。
 */
export const CONTRACT_VALUE_EDGE_ALLOWLIST: readonly string[] = [];

/**
 * 契约面这条上游值边是否放行。
 * @param specifier 说明符原文（如 `@deepseek-ai/dsh-llm`）。
 */
export function isAllowedContractValueEdge(specifier: string): boolean {
  return CONTRACT_VALUE_EDGE_ALLOWLIST.includes(specifier);
}

/**
 * 类型纪律判据的**存量基线**（过渡：收敛后删，改回 0 容忍）。
 *
 * 为什么要有：这几条的存量是**已接受的债**（当前：契约面值边 56 处；白名单外双断言 85 处，
 * 另有**测试域**同一判据 237 处记在 `"double-assertion-test"`），0 容忍会把 `just audit` 长期弄红，
 * 判据就没人看了。基线只挡**增量**——超出才红，等于打印当前数，低于提示下调。
 *
 * 删基线的判据：`just audit` 打出来的当前数降到 0（T5 清完契约面值边、T4 清完双断言），
 * 然后删掉这里的常量与 `summarize.ts` 的 `reportAgainstBaseline`，判据改回 `report()` 的 0 容忍。
 */
export const TYPE_DISCIPLINE_BASELINE = {
  /** 契约 / 端点面的上游包根值边（T5 收敛）。 */
  "contract-value-edge": 56,
  /**
   * 边界桥白名单外的 `as unknown as`（T4 收敛）。
   *
   * 168 已扣掉 desktop 壳 `src/app.ts` 的 4 处 Electron 边界桥（Electron 内置模块 / 进程对象 /
   * IPC 参数没有本仓类型面，见 `BRIDGES` 最后一条）——那 4 处此前计在 172 里，进白名单后随之下调。
   * 阶段 2 又下调 8 处：`dsh-session/src/testing/log.ts` 的会话事件夹具用品牌构造器装成了合法事件
   * （那一份在 `src/testing/` 下，算**生产面**）。
   */
  "double-assertion": 65,
  /**
   * **测试域**（`__tests__/**`）的同一条双断言判据：只降不升。
   *
   * 为什么单独一条：测试域的存量（实测 284 处）接近生产面（144 处）的两倍，两边合成一条时
   * 生产面的增量会被测试域的噪声淹掉，生产面那条「只挡增量」也就失效了。分成两条之后：生产面是
   * **硬门禁**（红就是红），测试域只挡增量、跟着每个阶段**逐档下调**。
   *
   * 边界桥白名单对两边同样适用（`bridgeReason()` 先于分类判）：另一头是外部形状（cordis Context /
   * SQL 行 / 上游私有内存）的断言在测试里也是正当的，不因为它落在 `__tests__` 里就变成可以随便写。
   */
  // 170 是**收紧白名单之后**的真实数：原来的 `src/__tests__/**` 通配吞掉了 68 处（review 抓到的），
  // 它们本来就是各包测试域的存量，不是「本仓 Context ↔ cordis Context」那一类边界桥。
  // 白名单只留 `zephyr` 的两个装配 spec（那 5 处才是真的类型面差异）。
  "double-assertion-test": 170,
} as const;

/** 当前数与基线比出来的三种结果。 */
export type BaselineVerdict = "ok" | "regressed" | "improvable";

/**
 * 当前数与基线比。
 * @param current 当前数。
 * @param baseline 基线（存量债的数）。
 * @returns `regressed` 超出基线（判据红）；`improvable` 低于基线（可以下调）；`ok` 正好。
 */
export function baselineVerdict(current: number, baseline: number): BaselineVerdict {
  if (current > baseline) return "regressed";
  if (current < baseline) return "improvable";
  return "ok";
}

// ── 子入口面（`src/compat/**`、`src/testing/**` …）的相对导入纪律
//
// 子入口面是包的**子出口**：对外是一层门面，对内不该伸手进兄弟目录。所以这些面里只许 `./` 与
// 包名/出口，跨目录的 `../` 一律禁——否则"面"退化成目录结构的一部分，改文件布局就破面向外契约。

/**
 * 被约束的子入口面目录名（`src/<面>/**`）。
 *
 * 五个面各是一个**子出口**：`ui` / `client`（浏览器半）、`server`（宿主半）、`compat` / `testing`
 * （兼容层与测试面）。它们之间共享的契约与令牌必须走**包出口**（`@morlay/<包>/contract`），不能靠
 * `../contract/…` 够过去——否则同一个出口的产物里会各内联一份契约类/令牌（多份实例，令牌身份也对不上）。
 */
export const SUBENTRY_FACES = ["ui", "client", "server", "compat", "testing"] as const;

/**
 * 这个文件落在哪个子入口面里。
 * @param file 文件路径（Windows 分隔符也认）。
 * @returns 面名；不在任何子入口面里则 `undefined`。
 */
export function subentryFaceOf(file: string): string | undefined {
  const normalized = file.split("\\").join("/");
  return SUBENTRY_FACES.find(
    (face) =>
      normalized.includes("/src/" + face + "/") || normalized.startsWith("src/" + face + "/"),
  );
}

/**
 * 这个文件是否落在某个子入口面里。
 * @param file 文件路径（可含任意前缀，Windows 分隔符也认）。
 */
export function isSubentryFaceFile(file: string): boolean {
  return subentryFaceOf(file) !== undefined;
}

/**
 * 说明符是不是往父目录走（`../` / `../../` / `..`）。
 *
 * 只是**候选**：面内的 `../`（解析后仍在同一个 `src/<面>/` 下）是合法的——判据按解析结果定，
 * 由调用方用面根比对。
 * @param specifier 说明符原文。
 */
export function isParentSpecifier(specifier: string): boolean {
  return specifier === ".." || specifier.startsWith("../");
}

/**
 * 子入口面相对导入的**存量基线**（过渡：收敛后删，改回 0 容忍）。
 *
 * 169 是五个子入口面（`ui` / `client` / `server` / `compat` / `testing`）里业务代码**跨面**相对导入的处数
 * （`../` 解析后落在同一个 `src/<面>/` 之外的；面内的 `../` 不算——那有 144 处，是合法的）。
 * 大户是 `zephyr-app`（测试面装整应用）、`ui` → `../contract/` 与 `server` → `../contract/` 这类"够兄弟目录"的写法。
 *
 * 先把这笔债记下来、只挡增量；清到 0 时删掉这条常量与 `summarize.ts` 的对应判据，改回 0 容忍。
 *
 * **151 里有一族是「testing 面要装实现」的固有缺口，不是可降项**：`src/testing/**` 与
 * `client/typert/typert.service.ts` 需要实现模块的类型/实例（`LocalRemote` 就是典型——它
 * `inject(RemoteHandlers)` 且 `extend Remote`，天然把实现面拖进 `testing` 出口；`full-app.ts`
 * 装整应用同理）。这一族要清得先给那几个契约开面中立出口（照 `./contract` / `./remote/decorators`
 * 的做法），属独立一票。**改数字前先分清「新增」与「既有族」**——之前两次把基线定低（144/146）
 * 都是因为测在了别人改动的中间态。
 */
export const SUBENTRY_BASELINE = {
  /** 子入口面里**跨出面**的相对导入（`__tests__` 豁免；面内 `../` 不算）。 */
  "parent-import": 127,
} as const;
