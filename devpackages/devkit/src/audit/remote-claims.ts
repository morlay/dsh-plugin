// **端点认领差集**的纯逻辑：谁需要哪个组 / 谁认领哪个组 / 哪些行真的装上了 → 差集。
//
// 判据一句话：客户端会调的每个 remote 组，宿主侧都必须有一个**认领者**，且该认领者所在的行
// 必须出现在应用的装配清单里。组名级判据只抓「整个组没认领」（浏览器侧 404 的形态）；
// 「组在但某方法没实现」由各包的闭环判据守。
//
// 这个文件只做**语法层**的事（解析事实、算差集），不读文件系统：扫描在 `package-audit.ts`（逐包）
// 与 `summarize.ts`（根上 + 应用清单）里，规则与豁免在 `rules.ts` 里。
import { parse } from "oxc-parser";

/** 认领者的三种形态。 */
export type ClaimKind = "handler" | "descriptor" | "route";

/** 一条认领事实。 */
export interface RemoteClaim {
  readonly kind: ClaimKind;
  /** 组名；`descriptor` 这一种留空（组名由它指向的上游模块决定，汇总器解析）。 */
  readonly group: string;
  /** 认领它的那一行的身份：`class:<类名>` 或 `spec:<模块说明符>`（`without(...)` 按同一个串剔除）。 */
  readonly row: string;
  readonly file: string;
}

/** 一条需求事实（浏览器半会调这个组）。 */
export interface RemoteDemand {
  /** 组名，或 `spec:<模块说明符>`（指向上游 上游 remote 出口，组名由汇总器解析）。 */
  readonly group: string;
  readonly file: string;
}

/** provide 清单（`provide([...])` 的产物）：名字 → 它列出的行。 */
export interface ProvideList {
  readonly provide: string;
  readonly rows: readonly string[];
}

/** `without(...)` 造成的剔除。 */
export interface ProvideRemoval {
  readonly from: string;
  readonly row: string;
}

/** provide 调用边（`from` 里调了 `to`）。 */
export interface ProvideEdge {
  readonly from: string;
  readonly to: string;
}

/** 一个类在组名继承链上的一条记录（同包跨文件、跨包都要靠它解析）。 */
export interface RemoteClassFact {
  readonly name: string;
  readonly group: string;
  readonly base: string;
}

/** 一个包的 remote 事实（`package-audit.ts` 逐包产出）。 */
export interface RemoteFacts {
  readonly claims: readonly RemoteClaim[];
  readonly demands: readonly RemoteDemand[];
  readonly edges: readonly ProvideEdge[];
  readonly lists: readonly ProvideList[];
  readonly removals: readonly ProvideRemoval[];
  /** 类表（组名继承链的原料：`@RemoteGroup()` 无名的行要沿基类找组名）。 */
  readonly classes: readonly RemoteClassFact[];
  /** 解析不出来的东西：**不能当通过**（汇总器单独打印）。 */
  readonly unknown: readonly string[];
}

/** AST 节点（ESTree 形态，只读用到的字段）。 */
interface Node {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** 遍历上下文：当前类名与当前 provide/辅助函数名。 */
interface WalkContext {
  readonly cls: string;
  readonly provider: string;
}

const EMPTY_CONTEXT: WalkContext = { cls: "", provider: "" };

/**
 * 深度遍历（带上下文）。
 * @param node 任意节点。
 * @param visit 命中回调。
 * @param context 进入时的上下文。
 */
function walk(node: unknown, visit: (node: Node, context: WalkContext) => void, context: WalkContext = EMPTY_CONTEXT): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, context);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const typed = node as Node;
  if (typeof typed.type !== "string") return;
  visit(typed, context);
  const next = contextOf(typed, context);
  for (const [key, value] of Object.entries(typed)) {
    if (key === "type" || key === "parent") continue;
    walk(value, visit, next);
  }
}

/**
 * 子节点上下文：类声明换 `cls`；清单声明/函数换 `provider`。
 * @param node 当前节点。
 * @param context 父上下文。
 * @returns 子上下文。
 */
function contextOf(node: Node, context: WalkContext): WalkContext {
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    return { cls: nameOf(node["id"]), provider: context.provider };
  }
  if (node.type === "FunctionDeclaration") {
    const name = nameOf(node["id"]);
    return { cls: "", provider: name === "" ? context.provider : name };
  }
  if (node.type === "VariableDeclarator") {
    const id = nameOf(node["id"]);
    const init = node["init"] as Node | null | undefined;
    const isFunction = init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression";
    const isProvide = init !== null && init !== undefined && init.type === "CallExpression" && calleeName(init) === "provide";
    return { cls: "", provider: (isFunction || isProvide) && id !== "" ? id : context.provider };
  }
  return context;
}

/**
 * 标识符名。
 * @param node 节点。
 * @returns 名字；不是标识符为空串。
 */
function nameOf(node: unknown): string {
  if (node === null || typeof node !== "object") return "";
  const typed = node as { type?: unknown; name?: unknown };
  return typed.type === "Identifier" && typeof typed.name === "string" ? typed.name : "";
}

/**
 * 字符串字面量值。
 * @param node 节点。
 * @returns 值；不是字面量时为空串。
 */
function stringOf(node: unknown): string {
  if (node === null || typeof node !== "object") return "";
  const value = (node as { value?: unknown }).value;
  return typeof value === "string" ? value : "";
}

/**
 * 被调名：`f(...)` → `f`，`a.f(...)` → `f`。
 * @param node 调用表达式。
 * @returns 名字；认不出来为空串。
 */
function calleeName(node: Node): string {
  if (node.type !== "CallExpression") return "";
  const callee = node["callee"] as Node | undefined;
  if (callee === undefined) return "";
  if (callee.type === "Identifier") return nameOf(callee);
  if (callee.type === "MemberExpression") return nameOf(callee["property"]);
  return "";
}

/**
 * 实参列表。
 * @param node 调用表达式。
 * @returns 实参。
 */
function argsOf(node: Node): readonly unknown[] {
  const args = node["arguments"] as readonly unknown[] | undefined;
  return args ?? [];
}

/**
 * `@RemoteGroup` 装饰器上的组名。
 * @param decorators 装饰器列表。
 * @returns 组名；`@RemoteGroup()` 无名时为空串（组名走基类）。
 */
function groupOfDecorators(decorators: unknown): string {
  for (const decorator of (decorators as readonly Node[] | undefined) ?? []) {
    const expression = decorator["expression"] as Node | undefined;
    if (expression === undefined || calleeName(expression) !== "RemoteGroup") continue;
    const options = argsOf(expression)[0] as Node | undefined;
    for (const property of (options?.["properties"] as readonly Node[] | undefined) ?? []) {
      if (nameOf(property["key"]) !== "name") continue;
      return stringOf(property["value"]);
    }
  }
  return "";
}

/**
 * 从一段子树里找 `import("…")` 的说明符。
 * @param node 子树根。
 * @returns 说明符；找不到为空串。
 */
function specifierIn(node: Node): string {
  let found = "";
  walk(node, (candidate) => {
    if (found !== "" || candidate.type !== "ImportExpression") return;
    found = stringOf(candidate["source"]);
  });
  return found;
}

/**
 * 一个清单元素的行身份：类标识符、`configure(类, …)`、`remoteDescriptor(() => import(…))`。
 * @param element 元素。
 * @returns `class:` / `spec:` 前缀的行身份；认不出来为空串。
 */
export function rowOfElement(element: unknown): string {
  if (element === null || typeof element !== "object") return "";
  const node = element as Node;
  if (node.type === "Identifier") return "class:" + nameOf(node);
  if (node.type !== "CallExpression") return "";
  const name = calleeName(node);
  if (name === "configure") return rowOfElement(argsOf(node)[0]);
  if (name === "remoteDescriptor") {
    const spec = specifierIn(node);
    return spec === "" ? "" : "spec:" + spec;
  }
  return "";
}

/**
 * 路由路径 → 组名：`/api/<名>` → `<名>`；`/<前缀>/…` → `<前缀>`。
 * @param path 路由路径。
 * @returns 组名；形状不认识时为空串。
 */
export function routeGroupOf(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  const head = segments[0];
  if (head === undefined) return "";
  return head === "api" ? (segments[1] ?? "") : head;
}

/**
 * 解析一个文件的 remote 事实。
 * @param file 文件路径（报告用；判定「浏览器半」按它）。
 * @param source 源码。
 * @param sharedClasses 同包共享的类表：`@RemoteGroup()` 无名的那批行，组名在**另一个文件**的契约类上。
 * @returns 事实。
 */
export async function remoteFactsOf(
  file: string,
  source: string,
  sharedClasses: Map<string, { group: string; base: string }> = new Map(),
): Promise<RemoteFacts> {
  const { program } = await parse(file, source);
  const claims: RemoteClaim[] = [];
  const demands: RemoteDemand[] = [];
  const edges: ProvideEdge[] = [];
  const lists: ProvideList[] = [];
  const removals: ProvideRemoval[] = [];
  const unknown: string[] = [];
  const classes = sharedClasses;
  const handlerRows = new Set<string>();
  const normalized = file.split("\\").join("/");
  // 传进来的是**包内相对路径**（`src/…`）：两种分隔符都归一成 `/`，前缀不带前导斜杠。
  const inUiFace = normalized.includes("src/ui/");
  const inEndpointFace = normalized.includes("src/endpoint/");

  walk(program, (node, context) => {
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const name = nameOf(node["id"]);
      if (name !== "") {
        classes.set(name, { group: groupOfDecorators(node["decorators"]), base: nameOf(node["superClass"]) });
      }
      return;
    }
    if (node.type === "ImportDeclaration") {
      const spec = stringOf(node["source"]);
      if (inUiFace && spec.startsWith("@deepseek-ai/") && spec.endsWith("/remote")) {
        demands.push({ group: "spec:" + spec, file: normalized });
      }
      return;
    }
    if (node.type !== "CallExpression") return;
    const name = calleeName(node);
    if (name === "registerRemoteGroup") {
      if (context.cls !== "") handlerRows.add(context.cls);
      return;
    }
    if (name === "without") {
      const row = rowOfElement(argsOf(node)[0]);
      if (row !== "" && context.provider !== "") removals.push({ from: context.provider, row });
      return;
    }
    if (name === "register") {
      const target = node["callee"] as Node | undefined;
      const carrier = JSON.stringify((target?.["object"] as Node | undefined) ?? {});
      if (!/webServer|WebServer|fetch/u.test(carrier)) return;
      const route = argsOf(node)[0] as Node | undefined;
      if (route === undefined || route.type !== "ObjectExpression") return;
      let path = "";
      for (const property of (route["properties"] as readonly Node[] | undefined) ?? []) {
        if (nameOf(property["key"]) === "path") path = stringOf(property["value"]);
      }
      const group = routeGroupOf(path);
      if (group === "") return;
      claims.push({
        kind: "route",
        group,
        row: context.cls === "" ? "" : "class:" + context.cls,
        file: normalized,
      });
      return;
    }
    if (name === "provide") {
      const listName = context.provider;
      const array = argsOf(node)[0] as Node | undefined;
      const rows: string[] = [];
      for (const element of (array?.["elements"] as readonly unknown[] | undefined) ?? []) {
        const elementNode = element as Node | null | undefined;
        if (elementNode === null || elementNode === undefined) continue;
        if (elementNode.type === "SpreadElement") {
          const inner = elementNode["argument"] as Node | undefined;
          if (inner !== undefined && inner.type === "CallExpression" && listName !== "") {
            edges.push({ from: listName, to: calleeName(inner) });
          }
          continue;
        }
        const row = rowOfElement(elementNode);
        if (row !== "") rows.push(row);
      }
      if (listName !== "") lists.push({ provide: listName, rows });
      return;
    }
    if (context.provider !== "" && name.startsWith("provide")) {
      edges.push({ from: context.provider, to: name });
    }
  });

  for (const row of handlerRows) {
    // 组名可能写在**另一个文件/另一个包**的契约类上：这里解析不出来时留空，由汇总器按合并类表再解析。
    claims.push({ kind: "handler", group: resolveGroup(row, classes), row: "class:" + row, file: normalized });
  }
  for (const list of lists) {
    for (const row of list.rows) {
      if (!row.startsWith("spec:")) continue;
      claims.push({ kind: "descriptor", group: "", row, file: normalized });
    }
  }
  // 需求：契约面（`src/endpoint`）声明的组就是浏览器会调的组（宿主半的组没有契约类）。
  if (inEndpointFace) {
    for (const [name, meta] of classes) {
      if (meta.group === "") continue;
      demands.push({ group: meta.group, file: normalized + "#" + name });
    }
  }
  const classFacts: RemoteClassFact[] = [...classes.entries()].map(([name, meta]) => ({
    name,
    group: meta.group,
    base: meta.base,
  }));
  return { claims, demands, edges, lists, removals, classes: classFacts, unknown };
}

/**
 * 沿类表解析组名（`@RemoteGroup()` 无名的那批走基类）。
 * @param className 类名。
 * @param classes 类表。
 * @returns 组名；解析不出来为空串。
 */
function resolveGroup(className: string, classes: Map<string, { group: string; base: string }>): string {
  let current = classes.get(className);
  for (let hop = 0; hop < 8 && current !== undefined; hop += 1) {
    if (current.group !== "") return current.group;
    current = current.base === "" ? undefined : classes.get(current.base);
  }
  return "";
}

/** 应用清单文件里的事实。 */
export interface AssemblyFacts {
  /** 清单里点名的清单函数：`provide*` 与**被展开**的辅助函数（`...settingsProviders()`）。 */
  readonly calls: readonly string[];
  /** 文件内部的调用边（辅助函数 → 它展开的清单函数）。 */
  readonly edges: readonly ProvideEdge[];
  /** `without(...)` 剔掉的行。 */
  readonly withouts: readonly string[];
}

/**
 * 解析应用装配清单（`apps/<应用>/src/zephyr.provide.ts`）：只读它点名了哪些清单函数与剔除项。
 * @param source 源码。
 * @returns 清单函数名与剔除的行身份。
 */
export async function assemblyFactsOf(source: string): Promise<AssemblyFacts> {
  const { program } = await parse("assembly.ts", source);
  const calls = new Set<string>();
  const withouts = new Set<string>();
  const edges: ProvideEdge[] = [];
  /** 展开位置（`...f()`）里的调用：清单的骨架就写在这里。 */
  const spreads = new Set<unknown>();
  walk(program, (node) => {
    if (node.type === "SpreadElement") spreads.add(node["argument"]);
  });
  walk(program, (node, context) => {
    if (node.type !== "CallExpression") return;
    const name = calleeName(node);
    if (name === "without") {
      const row = rowOfElement(argsOf(node)[0]);
      if (row !== "") withouts.add(row);
      return;
    }
    if (!name.startsWith("provide") && !spreads.has(node)) return;
    calls.add(name);
    if (context.provider !== "") edges.push({ from: context.provider, to: name });
  });
  return { calls: [...calls], edges, withouts: [...withouts] };
}

/**
 * 清单闭包：从点名的函数出发沿调用边展开，得到「装上的 provide 清单」与「被剔掉的行」。
 * @param input 点名、边、剔除。
 * @returns 装上的清单名、装上的行、被剔掉的行。
 */
export function installedOf(input: {
  readonly calls: readonly string[];
  readonly edges: readonly ProvideEdge[];
  readonly lists: readonly ProvideList[];
  readonly removals: readonly ProvideRemoval[];
  readonly withouts: readonly string[];
}): { readonly provides: ReadonlySet<string>; readonly rows: ReadonlySet<string> } {
  const provides = new Set<string>();
  const queue = [...input.calls];
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || provides.has(name)) continue;
    provides.add(name);
    for (const edge of input.edges) {
      if (edge.from === name && !provides.has(edge.to)) queue.push(edge.to);
    }
  }
  const removed = new Set<string>(input.withouts);
  for (const removal of input.removals) {
    if (provides.has(removal.from)) removed.add(removal.row);
  }
  const rows = new Set<string>();
  for (const list of input.lists) {
    if (!provides.has(list.provide)) continue;
    for (const row of list.rows) if (!removed.has(row)) rows.add(row);
  }
  return { provides, rows };
}

/** 差集的一项。 */
export interface MissingClaim {
  readonly group: string;
  /** 谁需要它（证据）。 */
  readonly demands: readonly string[];
  /** 有没有认领者（有 = 装了但被剔；没有 = 根本没行）。 */
  readonly claimedSomewhere: boolean;
}

/**
 * 算差集：需求 − 装上的认领。
 * @param input 需求、认领、装上的行、上游模块组名解析、豁免。
 * @returns 差集与解析不出来的需求。
 */
export function missingClaimsOf(input: {
  readonly demands: readonly RemoteDemand[];
  readonly claims: readonly RemoteClaim[];
  readonly installedRows: ReadonlySet<string>;
  readonly upstreamGroupsOf: (specifier: string) => readonly string[];
  readonly exempt: ReadonlySet<string>;
}): { readonly missing: readonly MissingClaim[]; readonly unknown: readonly string[] } {
  const unknown: string[] = [];
  const wanted = new Map<string, string[]>();
  for (const demand of input.demands) {
    const groups = demand.group.startsWith("spec:")
      ? input.upstreamGroupsOf(demand.group.slice("spec:".length))
      : [demand.group];
    if (groups.length === 0) {
      unknown.push("上游 descriptor 的组名解析不出来：" + demand.group + "  (" + demand.file + ")");
      continue;
    }
    for (const group of groups) {
      const evidences = wanted.get(group) ?? [];
      evidences.push(demand.file);
      wanted.set(group, evidences);
    }
  }
  const claimed = new Map<string, boolean>();
  for (const claim of input.claims) {
    const groups = claim.kind === "descriptor"
      ? input.upstreamGroupsOf(claim.row.slice("spec:".length))
      : [claim.group];
    const installed = claim.row !== "" && input.installedRows.has(claim.row);
    for (const group of groups) {
      claimed.set(group, (claimed.get(group) ?? false) || installed);
    }
  }
  const missing: MissingClaim[] = [];
  for (const [group, evidences] of wanted) {
    if (input.exempt.has(group)) continue;
    if (claimed.get(group) === true) continue;
    missing.push({ group, demands: evidences, claimedSomewhere: claimed.has(group) });
  }
  return { missing, unknown };
}