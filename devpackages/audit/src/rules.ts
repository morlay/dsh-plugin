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
  //    `zephyr-app` 声明它，是让联邦的外置名单认识这份 helper（删了 helper 会被内联进产物）。
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

/** 测试代码不受双断言白名单限制（测试里装整个应用是正当的）。 */
export function isTestPath(file: string): boolean {
  return /(^|[\\/])__tests__[\\/]/u.test(file);
}

/**
 * 边界桥白名单：`as unknown as` 唯一合法的地方。返回理由；`undefined` 表示不在白名单。
 *
 * 判据是「桥的另一头是什么**外部形状**」，不是「这个文件里断言多」。三类：装配入口（cordis Context）、
 * cordis 兼容桥、rdb 行映射（SQL 行）。**域内**的断言一律不白名单——`rdb/log/repair.ts` 的另一头是
 * 域对象，不是外部形状，所以它不在表里。
 */
const BRIDGES: readonly { readonly match: RegExp; readonly reason: string }[] = [
  { match: /(^|[\\/])src[\\/]bootstrap\.ts$/u, reason: "装配入口：另一头是 cordis Context" },
  {
    match: /(^|[\\/])src[\\/]compat[\\/]from-cordis\.ts$/u,
    reason: "cordis 兼容桥：上游 ctx / 服务 → 本仓契约",
  },
  {
    match: /(^|[\\/])src[\\/]rdb[\\/].*(rows|read-path|backend|log-import|migration)[^\\/]*\.ts$/u,
    reason: "rdb 行映射：另一头是 SQL 行（列值 → 域对象）",
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
 * 两条类型纪律判据的**存量基线**（过渡：收敛后删，改回 0 容忍）。
 *
 * 为什么要有：这两条的存量是**已接受的债**（记基线时：契约面值边 56 处、白名单外双断言 172 处），
 * 0 容忍会把 `just audit` 长期弄红，判据就没人看了。基线只挡**增量**——超出才红，等于打印当前数，
 * 低于提示下调。
 *
 * 删基线的判据：`just audit` 打出来的当前数降到 0（T5 清完契约面值边、T4 清完白名单外的双断言），
 * 然后删掉这里的两条常量与 `summarize.ts` 的 `reportAgainstBaseline`，两条判据改回 `report()` 的 0 容忍。
 */
export const TYPE_DISCIPLINE_BASELINE = {
  /** 契约 / 端点面的上游包根值边（T5 收敛）。 */
  "contract-value-edge": 56,
  /** 边界桥白名单外的 `as unknown as`（T4 收敛）。 */
  "double-assertion": 172,
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
