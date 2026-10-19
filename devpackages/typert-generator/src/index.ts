import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import {
  isTypeDeclaration,
  type Node,
  type ParsedFile,
  nameOf,
  parseFile,
  typeArgumentsOf,
  walkAll,
} from "./ast.ts";
import { reflectModel, type ReflectionModel } from "./reflection.ts";
import { type SchemaIndex, buildSchemaIndex, newContext, zodOf } from "./schema.ts";

// typert 产物生成：扫上游包的源码拿**方法面**（服务 / namespace / `@Remote` 方法 / 签名），拿声明树
// （`target/dts`，路径由调用方配置）当**类型面**，合成产物：
//
//   lib/typert.host.ts / lib/typert.client.ts   TYPERT 常量（invocations + 包反射）
//   lib/typert.remote-client.ts                 远端客户端面（TYPERT_REMOTE + declare module）
//
// 这是"ts → schema"的纯语法活：不建类型图、不依赖任何 TypeScript 版本。

/**
 * 上下文声明表：`declare module '@deepseek-ai/dsh-typert-protocol'` 里的
 * `TypertLookupMap { agent: TypertLookup<Agent, AgentId> }` / `TypertContextMap { agent: TypertContext<AgentId> }`。
 *
 * 两张表在上游是**分开**用的（`typert/generator/src/analyzer.ts`）：
 *
 * - `lookups`：参数**类型**是该条目的宿主类型（`Agent` / `WorkspaceFileScope`）时，它按 lookup 传，
 *   wire 名取 `${key}Id`；参数名必须等于 key、且不能可选。
 * - `contexts`：`@RemoteScope('<key>')` 的上下文必须在这里有条目（只有 lookup 条目不够），wire 名同样是
 *   `${key}Id`。
 *
 * 不能把两张表合并、也不能只按 wire id 类型认参数：`SessionId` 同时是 agent / session /
 * workspaceFileScope 的 wire 类型，按 id 类型认会把 `list(sessionId: SessionId)` 误当成 workspaceFileScope
 * 参数——gateway 会把 `{ sessionId, workspaceRoot }` 对象塞进这个位置，宿主拿它当字符串查表。
 */
interface ContextTables {
  readonly lookups: Map<string, { readonly hostType: string; readonly idType: string }>;
  readonly contexts: Map<string, { readonly idType: string }>;
  /** 包内声明的 class 名：未在 lookup 表注册的 class 参数不能按 JSON 传（上游 `isWorkspaceClass`）。 */
  readonly classes: ReadonlySet<string>;
}

/** RPC endpoint segment：与上游 `isRemoteSegment()` 同口径。 */
function isRemoteSegment(value: string): boolean {
  return value !== "." && value !== ".." && /^[A-Za-z0-9_$.-]+$/u.test(value);
}

/** 属性名 / 模块名：标识符与字符串字面量都取文本（上游 `memberName()`）。 */
function memberNameOf(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  const name = nameOf(node);
  if (name !== undefined) return name;
  if (node["type"] === "Literal" && typeof node["value"] === "string") return node["value"];
  if (node["type"] === "TemplateLiteral" && (node["expressions"] as unknown[]).length === 0) {
    const quasi = (node["quasis"] as Node[] | undefined)?.[0];
    const cooked = quasi?.["value"]?.["cooked"];
    return typeof cooked === "string" ? cooked : undefined;
  }
  return undefined;
}

/**
 * 扫上游包源码里的两张上下文声明表与 class 名。
 *
 * 校验口径与上游 `lookupDeclarations()` / `contextDeclarations()` / `typeMetaMapMembers()` 对齐：
 *
 * - 只认 `declare module '@deepseek-ai/dsh-typert-protocol'` 内的接口（普通 interface 同名不参与）；
 * - 条目必须是带类型的 property signature；
 * - key 必须是 RPC endpoint segment，且各自唯一；
 * - 值必须是 `TypertLookup<Host, Wire>` / `TypertContext<Wire>`，Host / Wire 必须是命名类型。
 *
 * 上游在违反时让生成失败；这里同样抛错——静默跳过会生成"看起来正常、运行时少一个 lookup"的产物。
 *
 * @param packages - 上游客包清单（名称与源码根）。
 * @returns lookup / context 两张表与包内 class 名。
 */
async function lookupContexts(
  packages: readonly { name: string; root: string }[],
): Promise<ContextTables> {
  const lookups = new Map<string, { hostType: string; idType: string }>();
  const contexts = new Map<string, { idType: string }>();
  const hosts = new Map<string, string>();
  const classes = new Set<string>();
  // 类型实参是引用节点（名字在 `typeName` 上）。
  const argumentName = (argument: Node | undefined): string | undefined =>
    argument === undefined ? undefined : nameOf((argument["typeName"] ?? argument) as Node);
  for (const pkg of packages) {
    for (const file of await sourceFiles(pkg.root)) {
      const parsed = await parseFile(file);
      walkAll(parsed.program, (node) => {
        if (node["type"] !== "ClassDeclaration") return;
        const name = nameOf(node["id"] as Node);
        if (name !== undefined) classes.add(name);
      });
      // 只扫协议模块：`typeMetaMapMembers()` 同样限定在 `declare module '@deepseek-ai/dsh-typert-protocol'`。
      for (const statement of parsed.program["body"] as Node[]) {
        if (statement["type"] !== "TSModuleDeclaration") continue;
        if (memberNameOf(statement["id"] as Node) !== "@deepseek-ai/dsh-typert-protocol") continue;
        const body = statement["body"] as Node | undefined;
        if (body?.["type"] !== "TSModuleBlock") continue;
        for (const nested of body["body"] as Node[]) {
          if (nested["type"] !== "TSInterfaceDeclaration") continue;
          const interfaceName = nameOf(nested["id"] as Node);
          if (interfaceName !== "TypertLookupMap" && interfaceName !== "TypertContextMap") continue;
          for (const member of (nested["body"]?.["body"] ?? []) as Node[]) {
            if (
              member["type"] !== "TSPropertySignature" ||
              member["typeAnnotation"] === undefined
            ) {
              throw new Error(`${interfaceName} entries must be required properties`);
            }
            const key = memberNameOf(member["key"] as Node);
            if (key === undefined || !isRemoteSegment(key)) {
              throw new Error(
                `${interfaceName} key must contain only RPC endpoint segment characters`,
              );
            }
            const annotation = member["typeAnnotation"]["typeAnnotation"] as Node | undefined;
            if (annotation?.["type"] !== "TSTypeReference") {
              throw new Error(
                `${interfaceName}.${key} 的值必须是 TypertLookup / TypertContext 引用`,
              );
            }
            const metaType = nameOf(annotation["typeName"] as Node);
            const args = typeArgumentsOf(annotation);
            if (interfaceName === "TypertLookupMap") {
              if (metaType !== "TypertLookup" || args.length !== 2) {
                throw new Error(
                  `${interfaceName}.${key} 的值必须是 TypertLookup<Host, Wire>（实际 ${String(metaType)}）`,
                );
              }
              const hostType = argumentName(args[0]);
              const idType = argumentName(args[1]);
              if (hostType === undefined || idType === undefined) {
                throw new Error(`${interfaceName}.${key} 的 Host / Wire 必须是命名类型`);
              }
              if (lookups.has(key)) throw new Error(`重复的 TypertLookupMap key ${key}`);
              const previousHost = hosts.get(hostType);
              if (previousHost !== undefined) {
                throw new Error(
                  `宿主类型 ${hostType} 有多个 Typert lookup（${previousHost} / ${key}）`,
                );
              }
              lookups.set(key, { hostType, idType });
              hosts.set(hostType, key);
              continue;
            }
            if (metaType !== "TypertContext" || args.length !== 1) {
              throw new Error(
                `${interfaceName}.${key} 的值必须是 TypertContext<Wire>（实际 ${String(metaType)}）`,
              );
            }
            const idType = argumentName(args[0]);
            if (idType === undefined) {
              throw new Error(`${interfaceName}.${key} 的 Wire 必须是命名类型`);
            }
            if (contexts.has(key)) throw new Error(`重复的 TypertContextMap key ${key}`);
            contexts.set(key, { idType });
          }
        }
      }
    }
  }
  return { lookups, contexts, classes };
}

/**
 * 缺省声明树：与 tsdown 的构建流程同一套（`repoRootOf(cwd)` → `ensureWorkspaceDts` → `dtsRootOf`）。
 *
 * 调用方不必再跑单独的 dts 子命令，也不必自己判断声明树在不在——声明树的生成与并发锁都收在
 * `@local/dts-prepare`。这里用动态 import：显式给 `dtsRoot` 的调用（测试、预演）不加载 rolldown。
 */
async function workspaceDtsRoot(): Promise<string> {
  const { dtsRootOf, ensureWorkspaceDts, repoRootOf } = await import("@local/dts-prepare");
  const root = await repoRootOf(process.cwd());
  await ensureWorkspaceDts(root);
  return dtsRootOf(root);
}

export type GenerateOptions = {
  /** 上游 clone 的根目录（`<vendor>/<name>`）：产物里的 `sourceLocation.file` 相对它。 */
  upstreamRoot: string;
  /**
   * 声明树根（`<root>/target/dts`）。缺省按 tsdown 的同一条流程解析：从 `cwd` 找仓库根、
   * `ensureWorkspaceDts()` 确保声明树就绪，再取 `<root>/target/dts`。测试可显式注入临时声明树。
   */
  dtsRoot?: string;
  /** 只处理这些包名（调试用）；缺省全量。 */
  packages?: readonly string[];
  /** 真写产物；缺省只返回文本（对照 / 预演）。 */
  write?: boolean;
};

export type GeneratedArtifact = {
  package: string;
  files: { path: string; text: string }[];
  invocations: number;
};

type RemoteMethod = {
  method: string;
  /** 实现方法名：与 wire 名不同时才写（gateway 靠它反射调用宿主的方法）。 */
  implementation?: string;
  /** `@Remote({ mode: 'stream' })` → `stream`；缺省 `direct`。 */
  mode: "direct" | "stream";
  /** 调用形态：`@Remote`（direct）或 `@RemoteScope`（context receiver）。 */
  invocation: "direct" | "context";
  /** context receiver 的上下文 key（`@RemoteScope('<key>')`）。 */
  context?: string;
  /** 声明面签名用的参数文本（含被 wire 跳过的 `signal`）。 */
  signatureParameters: string;
  parameters: {
    name: string;
    type: Node | undefined;
    optional: boolean;
    node: Node;
    /** lookup 参数的 key（`TypertLookupMap` 的键）：wire 名是 `${key}Id`，codec 用 wire id 类型。 */
    lookup?: string;
    /** lookup / `@RemoteScope` 参数的 wire id 类型：codec 用它而不是宿主对象注解。 */
    idType?: string;
  }[];
  /** 取消通道参数名（`signal: AbortSignal`）：wire 上不传，但 invocation 要记下来。 */
  cancellation?: string;
  /** 上下文名：来自 `@RemoteScope('<context>')`，或参数类型命中 `TypertLookupMap` / `TypertContextMap`。 */
  scope?: string;
  scopeWire?: string;
  scopeIdType?: string;
  result: Node | undefined;
  node: Node;
};

type RemoteService = {
  className: string;
  exportName: string;
  serviceKey: string;
  namespace: string;
  file: ParsedFile;
  docNode: Node;
  classNode: Node;
  methods: RemoteMethod[];
};

/** 剥掉 `export` / `export default` 壳，拿到里面的声明节点。 */
function unwrapExport(statement: Node): Node {
  if (statement["type"] === "ExportNamedDeclaration" && statement["declaration"] !== null) {
    return statement["declaration"] as Node;
  }
  if (statement["type"] === "ExportDefaultDeclaration") {
    const declaration = statement["declaration"] as Node | null;
    if (declaration !== null && declaration["type"] === "ClassDeclaration") return declaration;
  }
  return statement;
}

/** oxc 的参数名：`Identifier.name` 是字符串，解构参数在 `left` 上。 */
function parameterName(parameter: Node): string | undefined {
  const direct = parameter["name"];
  if (typeof direct === "string") return direct;
  return nameOf(direct as Node | undefined) ?? nameOf(parameter["left"] as Node | undefined);
}

/** 参数声明的类型名（`agent: Agent` → `Agent`；`signal: AbortSignal` → `AbortSignal`）。 */
function typeNameOf(parameter: Node): string | undefined {
  return nameOf(
    (parameter["typeAnnotation"]?.["typeAnnotation"] as Node)?.["typeName"] as Node | undefined,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function mangle(text: string): string {
  return text.replace(/[^a-zA-Z0-9]+/gu, "_");
}

/** `super(ctx, '<serviceKey>', { namespace: '<ns>' })` → 服务键与 namespace。 */
function serviceHeaderOf(klass: Node): { serviceKey: string; namespace: string } | undefined {
  let found: { serviceKey: string; namespace: string } | undefined;
  walkAll(klass, (node) => {
    if (found !== undefined || node["type"] !== "CallExpression") return;
    // oxc 把 `super(...)` 的 callee 建模成 `Super` 节点（不是 Identifier）。
    if ((node["callee"] as Node)["type"] !== "Super") return;
    const args = node["arguments"] as Node[];
    const serviceKey: unknown = args[1]?.["value"];
    let namespace: unknown;
    const options = args[2];
    if (options?.["type"] === "ObjectExpression") {
      for (const property of options["properties"] as Node[]) {
        if (nameOf(property["key"] as Node) === "namespace")
          namespace = property["value"]?.["value"];
      }
    }
    if (typeof serviceKey === "string") {
      // `namespace` 是可选的：不写时就是服务键（上游产物里 `namespace === service`）。
      found = { serviceKey, namespace: typeof namespace === "string" ? namespace : serviceKey };
    }
  });
  return found;
}

/** `@Remote('wire')` 的第一个字符串参数是 **wire 名**（缺省用方法名）；`@Remote({ mode: … })` 给载体。 */
/** 一个方法上的 Remote 调用装饰器（`@Remote` / `@RemoteScope`）。 */
interface RemoteMarker {
  readonly kind: "direct" | "context";
  /** `@RemoteScope` 的上下文 key。 */
  readonly context?: string;
  /** 导出方法名（`@Remote('name')` / `@RemoteScope('ctx', 'name')` 的字符串参数）。 */
  readonly wireName?: string;
  readonly mode: "direct" | "stream";
}

/** 字符串字面量取值（`@Remote` / `@RemoteScope` 的参数）。 */
function literalStringOf(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node["type"] === "Literal" && typeof node["value"] === "string") return node["value"];
  if (node["type"] === "TemplateLiteral" && (node["expressions"] as unknown[]).length === 0) {
    const cooked = (node["quasis"] as Node[] | undefined)?.[0]?.["value"]?.["cooked"];
    return typeof cooked === "string" ? cooked : undefined;
  }
  return undefined;
}

/** `@Remote` / `@RemoteScope` 的 options 对象里只取生成需要的 `mode`。 */
function modeOfOptions(node: Node): "direct" | "stream" {
  if (node["type"] !== "ObjectExpression") return "direct";
  for (const property of node["properties"] as Node[]) {
    if (nameOf(property["key"] as Node) === "mode" && property["value"]?.["value"] === "stream") {
      return "stream";
    }
  }
  return "direct";
}

/**
 * 解析方法上的 Remote 调用装饰器（与上游 `remoteMarker()` 同口径）。
 *
 * - `@Remote` / `@Remote()`：direct；第一个字符串参数是导出方法名，options 对象取 `mode`。
 * - `@RemoteScope('<key>')` / `@RemoteScope('<key>', '<name>' | options)`：context receiver。
 * - 一个方法只能有一个这样的装饰器。
 *
 * @param member - 类方法节点。
 * @returns 装饰器描述；没有 Remote 装饰器时 undefined。
 */
function remoteMarkerOf(member: Node): RemoteMarker | undefined {
  let found: RemoteMarker | undefined;
  const remote = (expression: Node, args: Node[]): RemoteMarker => {
    if (args.length === 0) return { kind: "direct", mode: "direct" };
    const name = literalStringOf(args[0]);
    if (name !== undefined) {
      if (!isRemoteSegment(name)) {
        throw new Error("Remote() name must contain only RPC endpoint segment characters");
      }
      return { kind: "direct", wireName: name, mode: "direct" };
    }
    return { kind: "direct", mode: modeOfOptions(args[0] as Node) };
  };
  const scope = (expression: Node, args: Node[]): RemoteMarker => {
    if (args.length < 1 || args.length > 2) {
      throw new Error(
        "RemoteScope() requires a Context key and an optional exported method name or options object",
      );
    }
    const context = literalStringOf(args[0]);
    if (context === undefined || !isRemoteSegment(context)) {
      throw new Error(
        "RemoteScope() key must be a string literal containing only RPC endpoint segment characters",
      );
    }
    const option = args[1];
    if (option === undefined) return { kind: "context", context, mode: "direct" };
    const name = literalStringOf(option);
    if (name === undefined) return { kind: "context", context, mode: modeOfOptions(option) };
    if (!isRemoteSegment(name)) {
      throw new Error(
        "RemoteScope() name must be a string literal containing only RPC endpoint segment characters",
      );
    }
    return { kind: "context", context, wireName: name, mode: "direct" };
  };
  for (const decorator of (member["decorators"] ?? []) as Node[]) {
    const expression = decorator["expression"] as Node;
    const decoratorName = nameOf((expression["callee"] ?? expression) as Node);
    let marker: RemoteMarker | undefined;
    if (decoratorName === "Remote") {
      const args = ((expression["arguments"] ?? []) as Node[]).filter(
        (argument) => argument["type"] !== "SpreadElement",
      );
      marker = remote(expression, args);
    } else if (decoratorName === "RemoteScope") {
      const args = ((expression["arguments"] ?? []) as Node[]).filter(
        (argument) => argument["type"] !== "SpreadElement",
      );
      marker = scope(expression, args);
    }
    if (marker === undefined) continue;
    if (found !== undefined) {
      throw new Error("a method can have only one Remote invocation decorator");
    }
    found = marker;
  }
  return found;
}

/** 声明面签名里的参数文本（源码切片，保留 `signal?: AbortSignal` 这类取消通道）。 */
function signatureParametersOf(source: string, member: Node): string {
  const params = (member["value"]?.["params"] ?? []) as Node[];
  return params
    .map((parameter) => {
      const start = parameter["start"] as number;
      const end = parameter["end"] as number;
      const text = source.slice(start, end).replace(/\s+/gu, " ").trim();
      // 取消通道在声明面上是可选的（调用方可以不给），wire 上则整个不进参数表。
      const isCancellation =
        nameOf(
          (parameter["typeAnnotation"]?.["typeAnnotation"] as Node)?.["typeName"] as
            | Node
            | undefined,
        ) === "AbortSignal";
      return isCancellation && !text.includes("?") ? text.replace(":", "?:") : text;
    })
    .join(", ");
}

/** 参数的 schema：可选参数（`options?`）在 wire 上是 `undefined | T`，`undefined` 排最前。 */
function schemaOfParameter(
  parameter: { type: Node | undefined; optional: boolean; idType?: string },
  context: Parameters<typeof zodOf>[1],
): string {
  // scope 参数（`@RemoteScope`，或类型命中上下文查找表）在 wire 上传的是 **id**：descriptor 里写作
  // `wire: 'agentId'` + `typeSymbol: '…#SessionId'`，即一个字符串 brand。schema 必须跟着 **wire 的类型**
  // 走，不能按宿主侧那个上下文对象（`Agent`）生成——否则客户端发 `{ id: … }`、服务端按 `SessionId`
  // 解析，gateway 直接判 `wire field "agentId" failed boundary validation`。
  const inner = parameter.idType === undefined ? zodOf(parameter.type, context) : "z.string()";
  return parameter.optional ? `z.union([z.undefined(), ${inner}])` : inner;
}

function remoteMethodsOf(klass: Node, source: string, tables: ContextTables): RemoteMethod[] {
  const methods: RemoteMethod[] = [];
  // 宿主对象类型 → lookup 条目（上游按**类型符号**命中 `TypertLookupMap`，一个宿主类型只能有一个 lookup）。
  const lookupByHost = new Map(
    [...tables.lookups].map(([key, entry]) => [entry.hostType, { key, ...entry }]),
  );
  for (const member of (klass["body"]?.["body"] ?? []) as Node[]) {
    if (member["type"] !== "MethodDefinition") continue;
    const marker = remoteMarkerOf(member);
    if (marker === undefined) continue;
    const declaredParameters = (member["value"]?.["params"] ?? []) as Node[];
    // 取消通道（上游 1164-1175）：名字 `signal` 与全局 `AbortSignal` 必须成对出现，且必须是最后一个参数。
    const isCancellation = (parameter: Node): boolean => typeNameOf(parameter) === "AbortSignal";
    for (const [index, parameter] of declaredParameters.entries()) {
      const cancellation = isCancellation(parameter);
      if ((parameterName(parameter) === "signal") !== cancellation) {
        throw new Error(
          "Remote cancellation must use a parameter named signal with the global AbortSignal type",
        );
      }
      if (cancellation && index !== declaredParameters.length - 1) {
        throw new Error("Remote cancellation signal must be the final parameter");
      }
    }
    const cancellation = declaredParameters.find(isCancellation);
    const parameters: RemoteMethod["parameters"] = declaredParameters
      // 取消通道只在本进程内传，wire 上没有它的位置——记成 invocation 的 `cancellation`。
      .filter((parameter) => !isCancellation(parameter))
      .map((parameter, index) => ({
        name: parameterName(parameter) ?? `arg${String(index)}`,
        type: parameter["typeAnnotation"]?.["typeAnnotation"] as Node | undefined,
        optional: parameter["optional"] === true,
        node: parameter,
      }));
    // lookup 参数按上游的判据认：参数**类型**是 `TypertLookupMap` 的宿主对象类型（`Agent` /
    // `WorkspaceFileScope`）；命中后参数名必须等于 lookup key、且不能可选。
    //
    // 不能只看 wire id 类型：`SessionId` 同时是 agent / session / workspaceFileScope 的 wire 类型，按类型认会
    // 把 `list(sessionId: SessionId)`、`retain(sessionId, id)` 误当成 workspaceFileScope 参数——gateway 会把
    // `{ sessionId, workspaceRoot }` 对象塞进这个位置，宿主拿它当字符串查表，于是终端清单恒空、retain 恒
    // `terminal/unavailable`（侧栏终端"此终端已不存在，请新建终端"就是这么来的）。
    const lookupHits = new Map<Node, { key: string; idType: string }>();
    for (const parameter of declaredParameters) {
      if (isCancellation(parameter)) continue;
      const typeName = typeNameOf(parameter);
      if (typeName === undefined) continue;
      const lookup = lookupByHost.get(typeName);
      if (lookup === undefined) {
        // 上游 `isWorkspaceClass`：包内 class 不是 JSON 值，未注册 lookup 时不能按 JSON 传。
        if (tables.classes.has(typeName)) {
          throw new Error(`non-JSON class parameter ${typeName} requires a TypertLookupMap entry`);
        }
        continue;
      }
      const name = parameterName(parameter);
      if (parameter["optional"] === true) {
        throw new Error(`lookup 参数 ${lookup.key} 不能是可选参数`);
      }
      if (name !== lookup.key) {
        throw new Error(
          `lookup 参数必须命名为 ${lookup.key}（实际 ${String(name)}；宿主类型 ${typeName}）`,
        );
      }
      lookupHits.set(parameter, { key: lookup.key, idType: lookup.idType });
      const modeled = parameters.find((candidate) => candidate.node === parameter);
      if (modeled !== undefined) {
        modeled.lookup = lookup.key;
        modeled.idType = lookup.idType;
      }
    }
    // wire 字段唯一：lookup 参数按 `${key}Id`、JSON 参数按名字（上游 duplicate wire field）。
    const wires = new Set<string>();
    for (const parameter of parameters) {
      const wire = parameter.idType === undefined ? parameter.name : `${parameter.name}Id`;
      if (wires.has(wire)) throw new Error(`重复的 Remote wire 字段 ${wire}`);
      wires.add(wire);
    }
    // 方法的 scope / receiver 有两条来源（与上游 `analyzer.ts` 的 `receiver` / `scope` 一致）：
    //
    // 1. `@RemoteScope('<key>')`：descriptor 的 `invocation` 是 context receiver，wire 为 `${key}Id`；
    //    receiver 独立于业务参数表（实现签名里本来就不写）。必须是 `TypertContextMap` 条目。
    // 2. direct 方法**恰好一个** lookup 参数、且同名条目也在 `TypertContextMap` 里：scope 取该参数。
    //    两个以上 lookup 参数时上游不设 scope（参数仍按 lookup 传）。
    let scope: string | undefined;
    let scopeIdType: string | undefined;
    if (marker.kind === "context") {
      const context = marker.context as string;
      const entry = tables.contexts.get(context);
      if (entry === undefined) {
        throw new Error(`@RemoteScope('${context}') 没有 TypertContextMap 条目`);
      }
      const wire = `${context}Id`;
      if (wires.has(wire)) throw new Error(`重复的 Remote wire 字段 ${wire}`);
      scope = context;
      scopeIdType = entry.idType;
    } else if (lookupHits.size === 1) {
      const [, hit] = [...lookupHits][0] as [Node, { key: string; idType: string }];
      const context = tables.contexts.get(hit.key);
      if (context !== undefined) {
        // 上游要求 scope 的 wire 类型与 lookup 的 wire 类型是同一个符号。
        if (context.idType !== hit.idType) {
          throw new Error(
            `context ${hit.key} 的 wire 类型 ${context.idType} 与 lookup wire 类型 ${hit.idType} 不一致`,
          );
        }
        scope = hit.key;
        scopeIdType = hit.idType;
      }
    }
    const implementation = String(nameOf(member["key"] as Node) ?? "");
    const method = marker.wireName ?? implementation;
    methods.push({
      method,
      ...(method === implementation ? {} : { implementation }),
      mode: marker.mode,
      invocation: marker.kind,
      ...(marker.context === undefined ? {} : { context: marker.context }),
      ...(scope === undefined ? {} : { scope }),
      ...(scope === undefined || scopeIdType === undefined
        ? {}
        : { scopeWire: `${scope}Id`, scopeIdType }),
      signatureParameters: signatureParametersOf(source, member),
      parameters,
      ...(cancellation === undefined
        ? {}
        : { cancellation: String(parameterName(cancellation) ?? "signal") }),
      result: member["value"]?.["returnType"]?.["typeAnnotation"] as Node | undefined,
      node: member,
    });
  }
  return methods.sort((left, right) => left.method.localeCompare(right.method));
}

/** 服务类：`extends TypertRemoteService`。 */
function servicesOf(file: ParsedFile, tables: ContextTables): RemoteService[] {
  const found: RemoteService[] = [];
  for (const statement of file.program["body"] as Node[]) {
    // `export class X` / `export default class X` / 裸 `class X` 三种都要认。
    const declaration = unwrapExport(statement);
    if (declaration["type"] !== "ClassDeclaration") continue;
    const methods = remoteMethodsOf(declaration, file.source, tables);
    if (methods.length === 0) continue;
    const header = serviceHeaderOf(declaration);
    if (header === undefined) continue;
    found.push({
      className: String(nameOf(declaration["id"] as Node) ?? ""),
      exportName:
        statement["type"] === "ExportDefaultDeclaration"
          ? "default"
          : String(nameOf(declaration["id"] as Node) ?? ""),
      docNode: statement,
      classNode: declaration,
      serviceKey: header.serviceKey,
      namespace: header.namespace,
      file,
      methods,
    });
  }
  return found;
}

/**
 * client 面的包集合：自己有 client 半（`src/client` 或 `dsh.client`），或被 client 半 import 过。
 *
 * 上游是按它自己的 client aggregate（两份 tsconfig 的 references）挑的，那份配置本仓库已删；这里按
 * 「谁在 client 面露过面」推——服务被 client 半引用的包（`ctx.compaction`、`ctx.fileReference` 这类）
 * 同样要产 `typert.client.ts`，否则客户端的远程面会缺一整块。
 */
async function clientFacingPackages(
  upstreamRoot: string,
  packages: readonly { name: string; root: string }[],
): Promise<Set<string>> {
  const result = new Set<string>();
  const names = new Map(packages.map((pkg) => [pkg.name, pkg]));
  for (const pkg of packages) {
    const hasClientHalf =
      (await pathExists(join(pkg.root, "src", "client"))) || (await clientHalfOf(pkg.root));
    if (hasClientHalf) result.add(pkg.name);
  }
  const clientFiles: string[] = [];
  for (const pkg of packages) {
    // 只看 client 半：`src/client/**` 与 `src/client.ts` 这两种形态都要。
    for (const file of await filesUnder(join(pkg.root, "src"))) {
      const relativePath = relative(pkg.root, file).split(sep).join("/");
      if (relativePath.startsWith("src/client")) clientFiles.push(file);
    }
  }
  for (const file of clientFiles) {
    const parsed = await parseFile(file);
    for (const statement of parsed.program["body"] as Node[]) {
      if (statement["type"] !== "ImportDeclaration") continue;
      const specifier = statement["source"]?.["value"];
      if (typeof specifier !== "string" || !specifier.startsWith("@")) continue;
      const name = specifier.split("/").slice(0, 2).join("/");
      if (names.has(name)) result.add(name);
    }
  }
  return result;
}

async function sourceFiles(pkgDir: string): Promise<string[]> {
  return filesUnder(join(pkgDir, "src"));
}

/** 目录下的 TS 源文件（不拼 `src`：调用方给的就是要扫的那层）。 */
async function filesUnder(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        await walk(full);
      } else if (/\.tsx?$/u.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        found.push(full);
      }
    }
  }
  await walk(root);
  return found.sort();
}

/** 包是否有 client 半：`src/client/` 目录或清单里的 `dsh.client` 声明。 */
async function clientHalfOf(pkgDir: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as {
      dsh?: { client?: unknown };
    };
    return typeof manifest.dsh?.client === "object" && manifest.dsh.client !== null;
  } catch {
    return false;
  }
}

export async function packageDirs(upstreamRoot: string): Promise<string[]> {
  const found: string[] = [];
  for (const group of await readdir(join(upstreamRoot, "packages"), { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!group.isDirectory()) continue;
    const groupDir = join(upstreamRoot, "packages", group.name);
    // 上游是 `packages/<组>/<包>` 两层；也存在一层布局（`packages/<包>`，例如 generator 的 fixtures）。
    if (await pathExists(join(groupDir, "package.json"))) found.push(groupDir);
    for (const pkg of await readdir(groupDir, { withFileTypes: true }).catch(() => [])) {
      if (pkg.isDirectory() && pkg.name !== "node_modules") found.push(join(groupDir, pkg.name));
    }
  }
  return found.sort();
}

export async function generateTypert(options: GenerateOptions): Promise<GeneratedArtifact[]> {
  // 先扫出包清单：client 面的成员判定要按"谁在 client 面露过面"来算（见 `clientFacingPackages`）。
  const discovered: { name: string; root: string }[] = [];
  for (const pkgDir of await packageDirs(options.upstreamRoot)) {
    try {
      const manifest = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as {
        name?: string;
      };
      if (manifest.name !== undefined) discovered.push({ name: manifest.name, root: pkgDir });
    } catch {
      // 没有清单的目录不是包
    }
  }
  const clientPackages = await clientFacingPackages(options.upstreamRoot, discovered);
  const tables = await lookupContexts(discovered);
  const owners = new Map<string, string | undefined>();
  const dtsRoot = options.dtsRoot ?? (await workspaceDtsRoot());
  const index = await buildSchemaIndex(dtsRoot, {
    // 声明树里的位置 `<dtsRoot>/<仓库相对路径>` 就是包目录的位置，包名仍从上游清单读。
    ownerOf: async (file) => {
      // 声明树按仓库根布局（`<dtsRoot>/<仓库相对路径>`），从 dtsRoot 反推仓库根就得到真实路径；
      // 包根按路径里的 `src/` 段切——声明可能住在 `src/<子目录>/…`，数目录层级会数错。
      const repoRoot = dirname(dirname(dtsRoot));
      const absolute = join(repoRoot, relative(dtsRoot, file));
      const srcIndex = absolute.lastIndexOf(`${sep}src${sep}`);
      const pkgDir = srcIndex < 0 ? dirname(absolute) : absolute.slice(0, srcIndex);
      // 按**文件**缓存：同一个包里不同文件属于不同出口（`src/types.ts` 是 `/types`，`src/client/x.ts`
      // 是 `/client`），按包缓存会把第一个文件的出口当成全包的。
      const cached = owners.get(file);
      if (cached !== undefined) return cached;
      const owner = await ownerFor(pkgDir, file);
      owners.set(file, owner);
      return owner;
    },
  });
  indexForSymbols = index;
  const surfaces = await packageSurfaces(discovered);
  if (process.env["TYPERT_DEBUG"] === "1") {
    const att = surfaces.exports.get("@deepseek-ai/dsh-attachment");
    console.error(
      "[dbg] attachment 出口:",
      JSON.stringify(
        [...(att?.keys() ?? [])].filter((k) => k.toLowerCase().includes("attachmentid")),
      ),
    );
    const aliases = surfaces.aliases.get("api/session-controller/src/types");
    console.error(
      "[dbg] types.ts 别名:",
      JSON.stringify([...(aliases?.entries() ?? [])].slice(0, 4)),
    );
  }
  surfaceExports = surfaces.exports;
  surfaceAliases = surfaces.aliases;
  const artifacts: GeneratedArtifact[] = [];
  for (const pkgDir of await packageDirs(options.upstreamRoot)) {
    let name: string | undefined;
    try {
      name = (JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as { name?: string })
        .name;
    } catch {
      continue;
    }
    if (name === undefined) continue;
    if (options.packages !== undefined && !options.packages.includes(name)) continue;
    const services: RemoteService[] = [];
    for (const file of await sourceFiles(pkgDir)) {
      services.push(...servicesOf(await parseFile(file), tables));
    }
    if (services.length === 0) continue;
    const text = renderHostArtifact(name, services, index, options.upstreamRoot, "host");
    const remote = renderRemoteClient(name, services, index, options.upstreamRoot);
    const hostPath = join(pkgDir, "lib", "typert.host.ts");
    const remotePath = join(pkgDir, "lib", "typert.remote-client.ts");
    // 有 client 半的包另出一份 client 面的 TYPERT（invocations 相同，face 与反射面不同）。
    const clientPath = join(pkgDir, "lib", "typert.client.ts");
    const client = clientPackages.has(name)
      ? renderHostArtifact(name, services, index, options.upstreamRoot, "client")
      : undefined;
    if (options.write === true) {
      await mkdir(join(pkgDir, "lib"), { recursive: true });
      await writeFile(hostPath, text);
      await writeFile(remotePath, remote);
      // 没有 client 半的包要把旧的 `typert.client.ts` 删掉：产物是按包覆盖写的，留着上一次的会变成
      // 引用已改名常量的陈旧文件（运行时直接炸）。
      if (client === undefined) await rm(clientPath, { force: true });
      else await writeFile(clientPath, client);
    }
    artifacts.push({
      package: name,
      files: [
        { path: hostPath, text },
        { path: remotePath, text: remote },
        ...(client === undefined ? [] : [{ path: clientPath, text: client }]),
      ],
      invocations: services.reduce((total, service) => total + service.methods.length, 0),
    });
  }
  return artifacts;
}

/** 远端客户端面：wire 描述（descriptors）+ 给消费方用的类型增强（`declare module`）。 */
export function renderRemoteClient(
  name: string,
  services: readonly RemoteService[],
  index: SchemaIndex,
  upstreamRoot: string,
): string {
  const lines: string[] = [
    "/* Generated by @local/typert-generator — do not edit. */",
    "import { z } from 'zod'",
    "",
  ];
  const descriptors: string[] = [];
  const packagePrefix = mangle(name);
  const typeRefs = new Map<string, Set<string>>();
  const namedSchemas = new Map<string, string>();
  const flushNamedRemote = (context: { named: Map<string, string> }): void => {
    for (const [typeName, definition] of context.named) {
      if (namedSchemas.has(typeName)) continue;
      namedSchemas.set(typeName, definition);
      lines.push(
        `let ${typeName}$schema$value`,
        `const ${typeName}$schema = () => (${typeName}$schema$value ??= ${definition})`,
      );
    }
  };
  for (const service of services) {
    for (const method of service.methods) {
      const prefix = `${packagePrefix}_${mangle(service.namespace)}_${mangle(method.method)}`;
      const parameters = method.parameters.map((parameter, position) => {
        const symbol = `${prefix}_parameter_${String(position)}`;
        const context = newContext(index, {
          file: service.file.path,
          exports: surfaceExports,
          aliases: surfaceAliases,
        });
        lines.push(
          `let ${symbol}$schema$value`,
          `const ${symbol}$schema = () => (${symbol}$schema$value ??= ${schemaOfParameter(parameter, context)})`,
        );
        collectOwners(context.referenced, index, typeRefs);
        flushNamedRemote(context);
        return { parameter, symbol };
      });
      const resultSymbol = `${prefix}_result`;
      const resultContext = newContext(index, {
        file: service.file.path,
        exports: surfaceExports,
        aliases: surfaceAliases,
      });
      lines.push(
        `let ${resultSymbol}$schema$value`,
        `const ${resultSymbol}$schema = () => (${resultSymbol}$schema$value ??= ${zodOf(method.result, resultContext)})`,
      );
      collectOwners(resultContext.referenced, index, typeRefs);
      flushNamedRemote(resultContext);
      const file = relative(upstreamRoot, service.file.path).split(sep).join("/");
      const line = lineOf(service.file, (method.node["key"] as Node | undefined) ?? method.node);
      descriptors.push(
        [
          "    {",
          `      id: '${name}#${service.namespace}/${method.method}',`,
          `      service: '${service.serviceKey}',`,
          `      namespace: '${service.namespace}',`,
          `      method: '${method.method}',`,
          ...(method.implementation === undefined
            ? []
            : [`      implementation: '${method.implementation}',`]),
          ...(method.mode === "stream" ? ["      mode: 'stream',"] : []),
          // `@RemoteScope` 是 Context receiver（`{ kind: 'context', context, wire }`）；
          // 普通 `@Remote` 是 direct，命中查找表的方法另记 scope。
          ...(method.invocation === "context"
            ? [
                `      invocation: { kind: 'context', context: '${String(method.context)}', wire: '${String(method.scopeWire ?? `${String(method.context)}Id`)}' },`,
              ]
            : ["      invocation: { kind: 'direct' },"]),
          ...(method.invocation === "direct" && method.scope !== undefined
            ? [
                "      scope: {",
                `        context: '${method.scope}',`,
                `        wire: '${method.scopeWire ?? `${method.scope}Id`}',`,
                "      },",
              ]
            : []),
          "      parameters: [",
          ...parameters.map(({ parameter, symbol }) =>
            [
              "        {",
              `          name: '${parameter.name}',`,
              // lookup 参数用**自己的** key 生成 wire / lookup 名，不能从 method.scope 取：一个方法可以
              // 有多个 lookup 参数（上游此时不设 scope），scope 为空时从它取会写出 `undefinedId`。
              ...(parameter.lookup === undefined
                ? [
                    `          wire: '${parameter.name}',`,
                    "          source: 'json',",
                    // 可选参数在 wire 上可以缺：gateway 判断"这个字段能少"看的就是它（`api/gateway` 的
                    // `missing` 过滤）。只靠签名里的 `?` 不够——descriptor 里没这个标记，客户端省略
                    // 该字段时会被判成"缺了必填"（`wire field "…" failed boundary validation`）。
                    ...(parameter.optional ? ["          acceptsUndefined: true,"] : []),
                  ]
                : [
                    `          wire: '${parameter.lookup}Id',`,
                    "          source: 'lookup',",
                    `          lookup: '${parameter.lookup}',`,
                  ]),
              "          codec: {",
              "            mode: 'strict',",
              `            typeSymbol: '${parameter.idType === undefined ? (typeSymbolOf(parameter.type, index) ?? `${name}#${service.namespace}/${method.method}:${parameter.name}`) : (symbolForName(parameter.idType) ?? `${name}#${service.namespace}/${method.method}:${parameter.name}`)}',`,
              `            create: ${symbol}$schema,`,
              "          },",
              "        },",
            ].join("\n"),
          ),
          "      ],",
          ...(method.cancellation === undefined
            ? []
            : [`      cancellation: { parameter: '${method.cancellation}' },`]),
          "      result: {",
          "        mode: 'strict',",
          `        typeSymbol: '${typeSymbolOf(method.result, index) ?? `${name}#${service.namespace}/${method.method}:result`}',`,
          `        create: ${resultSymbol}$schema,`,
          "      },",
          `      sourceLocation: ${JSON.stringify({ file, line: line.line, column: line.column })},`,
          "    },",
        ].join("\n"),
      );
    }
  }
  lines.push(
    "",
    "export const TYPERT_REMOTE: TypertRemoteContribution = {",
    `  package: '${name}',`,
    "  descriptors: [",
    ...descriptors,
    "  ],",
    "}",
    "",
    "export default TYPERT_REMOTE",
    "",
    "/* Generated by @local/typert-generator from the Host FaceModel — do not edit. */",
    "import type {",
    "  RemoteResult,",
    // `RemoteStreamHandle` 只在真有 stream 方法时引（与上游产物一致，也不留空 import）。
    ...(services.some((service) => service.methods.some((method) => method.mode === "stream"))
      ? ["  RemoteStreamHandle,"]
      : []),
    "  TypertRemoteContribution,",
    "} from '@deepseek-ai/dsh-typert-protocol'",
    ...typeImportsOf(typeRefs),
    "",
    "declare module '@deepseek-ai/dsh-typert-protocol' {",
  );
  for (const service of services) {
    lines.push(`  interface TypertRemoteNamespace$${hexOf(service.namespace)} {`);
    // Context-only 方法（`@RemoteScope`）不在 direct 方法表里：调用方从 `TypertRemoteScopeMap`
    // 的已绑定上下文载体发起（上游 `remote-model.spec.ts` 376-384）。
    for (const method of service.methods.filter((candidate) => candidate.invocation === "direct")) {
      lines.push(
        `    ${method.method}: ${signatureFor(method, service.file.source, method.scope !== undefined)}`,
      );
    }
    lines.push("  }");
  }
  lines.push("  interface TypertRemoteMap {");
  for (const service of services) {
    for (const method of service.methods.filter((candidate) => candidate.invocation === "direct")) {
      lines.push(
        `    '${service.namespace}/${method.method}': ${signatureFor(method, service.file.source, method.scope !== undefined)}`,
      );
    }
  }
  lines.push("  }");
  lines.push("  interface TypertRemoteNamespaceMap {");
  for (const service of services) {
    lines.push(`    '${service.namespace}': TypertRemoteNamespace$${hexOf(service.namespace)}`);
  }
  lines.push("  }");
  // ScopeMap：`@RemoteScope` 的调用方在已绑定上下文的载体里发起，签名里不再重复上下文参数。
  const scoped = services.flatMap((service) =>
    service.methods
      .filter((method) => method.scope !== undefined)
      .map((method) => ({ service, method })),
  );
  if (scoped.length > 0) {
    lines.push("  interface TypertRemoteScopeMap {");
    for (const { service, method } of scoped) {
      lines.push(
        `    '${String(method.scope)}:${service.namespace}/${method.method}': ${signatureFor(method, service.file.source, true, true)}`,
      );
    }
    lines.push("  }");
  }
  // 末尾照上游留一个空行。
  lines.push("}", "", "");
  return `${lines.join("\n")}`;
}

/** 声明面签名：direct 走 `Promise<RemoteResult<T>>`，stream 走 `RemoteStreamHandle<T, never>`。 */
function signatureFor(
  method: RemoteMethod,
  source: string,
  scopeAsId = false,
  dropScope = false,
): string {
  const inner = returnInnerOf(method.result, source);
  const wrapped =
    method.mode === "stream"
      ? `RemoteStreamHandle<${inner}, never>`
      : `Promise<RemoteResult<${inner}>>`;
  // scope 方法在客户端签名里用上下文 id 代替宿主侧的对象参数（`agent: Agent` → `agentId: SessionId`）。
  // `scopeAsId`：上下文参数以 id 形态出现在签名里（`agent: Agent` → `agentId: SessionId`）。
  // `dropScope`：已经绑定了上下文的载体里，签名不再重复它。
  const parameters = dropScope
    ? signatureParametersWithoutScope(method)
    : scopeAsId && method.scope !== undefined
      ? signatureParametersWithScopeId(method)
      : method.signatureParameters;
  return `(${parameters}) => ${wrapped}`;
}

function returnInnerOf(type: Node | undefined, source: string): string {
  if (type === undefined) return "void";
  if (type["type"] === "TSTypeReference") {
    const name = nameOf(type["typeName"] as Node);
    const args = typeArgumentsOf(type);
    if ((name === "Promise" || name === "AsyncIterable") && args.length >= 1) {
      return typeTextOf(args[0] as Node, source);
    }
  }
  return typeTextOf(type, source);
}

/** 类型节点 → 源码文本（声明面签名里保留原样，如 `ProductEvent` / `boolean`）。 */
function typeTextOf(node: Node, source: string): string {
  if (typeof node["start"] === "number" && typeof node["end"] === "number") {
    return source
      .slice(node["start"] as number, node["end"] as number)
      .replace(/\s+/gu, " ")
      .trim();
  }
  return "unknown";
}

function collectOwners(
  names: Iterable<string>,
  index: SchemaIndex,
  into: Map<string, Set<string>>,
): void {
  for (const name of names) {
    const owner = index.get(name)?.owner;
    if (owner === undefined) continue;
    const parts = /^(.*?)(\/[^/]*)?$/u.exec(owner);
    const pkg = parts?.[1] ?? owner;
    const subpath = parts?.[2] ?? "";
    const bucket = into.get(pkg) ?? new Set<string>();
    bucket.add(`${name}${subpath === "" ? "" : `@${subpath}`}`);
    into.set(pkg, bucket);
  }
}

function typeImportsOf(typeRefs: Map<string, Set<string>>): string[] {
  const lines: string[] = [];
  for (const [pkg, names] of [...typeRefs].sort((left, right) => left[0].localeCompare(right[0]))) {
    const plain = [...names].map((entry) => entry.split("@")[0] ?? entry).sort();
    lines.push(`import type { ${plain.join(", ")} } from '${pkg}${subpathFor(names)}'`);
  }
  return lines;
}

function subpathFor(names: Set<string>): string {
  for (const entry of names) {
    const at = entry.indexOf("@");
    if (at >= 0) return entry.slice(at + 1);
  }
  return "";
}

function hexOf(text: string): string {
  return Buffer.from(text, "utf8").toString("hex");
}

/** host / client 面的 TYPERT 常量文本（含具名 schema 定义与包反射）。 */
export function renderHostArtifact(
  name: string,
  services: readonly RemoteService[],
  index: SchemaIndex,
  upstreamRoot: string,
  face: "host" | "client" = "host",
): string {
  // 有 schema 才引 `zod`（没有 invocation 的包不该留空 import）。
  const hasSchemas = services.some((service) => service.methods.length > 0);
  const lines: string[] = [
    "/* Generated by @local/typert-generator — do not edit. */",
    ...(hasSchemas ? ["import { z } from 'zod'"] : []),
    "",
  ];
  const invocations: string[] = [];
  const namedSchemas = new Map<string, string>();
  const typeNamesOf = new Map<Node, string[]>();
  // 递归类型的具名 schema 先落（`let X$schema$value` 那一对），引用处的 `z.lazy` 才有东西可指。
  const flushNamed = (context: { named: Map<string, string> }): void => {
    for (const [typeName, definition] of context.named) {
      if (namedSchemas.has(typeName)) continue;
      namedSchemas.set(typeName, definition);
      lines.push(
        `let ${typeName}$schema$value`,
        `const ${typeName}$schema = () => (${typeName}$schema$value ??= ${definition})`,
      );
    }
  };
  const symbolOf = (type: Node | undefined, fallback: string): string =>
    typeSymbolOf(type, index) ?? fallback;
  const packagePrefix = mangle(name);
  for (const service of services) {
    for (const method of service.methods) {
      const prefix = `${packagePrefix}_${mangle(service.namespace)}_${mangle(method.method)}`;
      const referenced: string[] = [];
      const parameters = method.parameters.map((parameter, position) => {
        const symbol = `${prefix}_parameter_${String(position)}`;
        const context = newContext(index, {
          file: service.file.path,
          exports: surfaceExports,
          aliases: surfaceAliases,
        });
        const zod = schemaOfParameter(parameter, context);
        referenced.push(...context.referenced);
        flushNamed(context);
        lines.push(
          `let ${symbol}$schema$value`,
          `const ${symbol}$schema = () => (${symbol}$schema$value ??= ${zod})`,
        );
        return { parameter, symbol };
      });
      const resultSymbol = `${prefix}_result`;
      const resultContext = newContext(index, {
        file: service.file.path,
        exports: surfaceExports,
        aliases: surfaceAliases,
      });
      const resultZod = zodOf(method.result, resultContext);
      referenced.push(...resultContext.referenced);
      flushNamed(resultContext);
      lines.push(
        `let ${resultSymbol}$schema$value`,
        `const ${resultSymbol}$schema = () => (${resultSymbol}$schema$value ??= ${resultZod})`,
      );
      typeNamesOf.set(method.node, referenced);
      const file = relative(upstreamRoot, service.file.path).split(sep).join("/");
      // 位置指方法名（不是装饰器），形态是 JSON 字面量（键带引号、无空格）。
      const line = lineOf(service.file, (method.node["key"] as Node | undefined) ?? method.node);
      invocations.push(
        [
          "    {",
          `      id: '${name}#${service.namespace}/${method.method}',`,
          `      service: '${service.serviceKey}',`,
          `      namespace: '${service.namespace}',`,
          `      method: '${method.method}',`,
          // wire 名与实现名不同时要写 `implementation`（gateway 拿它反射调用宿主方法）。
          ...(method.implementation === undefined
            ? []
            : [`      implementation: '${method.implementation}',`]),
          // `mode` 是 registry 判定载体（stream 还是 unary）的依据，host 面与远端面都要写。
          ...(method.mode === "stream" ? ["      mode: 'stream',"] : []),
          // `@RemoteScope` 是 Context receiver（`{ kind: 'context', context, wire }`），receiver 不占业务参数；
          // 普通 `@Remote` 是 direct，命中查找表的方法另记 scope。
          ...(method.invocation === "context"
            ? [
                `      invocation: { kind: 'context', context: '${String(method.context)}', wire: '${String(method.scopeWire ?? `${String(method.context)}Id`)}' },`,
              ]
            : ["      invocation: { kind: 'direct' },"]),
          ...(method.invocation === "direct" && method.scope !== undefined
            ? [
                "      scope: {",
                `        context: '${method.scope}',`,
                `        wire: '${method.scopeWire ?? `${method.scope}Id`}',`,
                "      },",
              ]
            : []),
          "      parameters: [",
          ...parameters.map(({ parameter, symbol }) =>
            [
              "        {",
              `          name: '${parameter.name}',`,
              // lookup 参数用**自己的** key 生成 wire / lookup 名，不能从 method.scope 取：一个方法可以
              // 有多个 lookup 参数（上游此时不设 scope），scope 为空时从它取会写出 `undefinedId`。
              ...(parameter.lookup === undefined
                ? [
                    `          wire: '${parameter.name}',`,
                    "          source: 'json',",
                    // 可选参数在 wire 上可以缺：gateway 判断"这个字段能少"看的就是它（`api/gateway` 的
                    // `missing` 过滤）。只靠签名里的 `?` 不够——descriptor 里没这个标记，客户端省略
                    // 该字段时会被判成"缺了必填"（`wire field "…" failed boundary validation`）。
                    ...(parameter.optional ? ["          acceptsUndefined: true,"] : []),
                  ]
                : [
                    `          wire: '${parameter.lookup}Id',`,
                    "          source: 'lookup',",
                    `          lookup: '${parameter.lookup}',`,
                  ]),
              "          codec: {",
              "            mode: 'strict',",
              `            typeSymbol: '${parameter.idType === undefined ? symbolOf(parameter.type, `${name}#${service.namespace}/${method.method}:${parameter.name}`) : (symbolForName(parameter.idType) ?? `${name}#${service.namespace}/${method.method}:${parameter.name}`)}',`,
              `            create: ${symbol}$schema,`,
              "          },",
              "        },",
            ].join("\n"),
          ),
          "      ],",
          ...(method.cancellation === undefined
            ? []
            : [`      cancellation: { parameter: '${method.cancellation}' },`]),
          "      result: {",
          "        mode: 'strict',",
          `        typeSymbol: '${symbolOf(method.result, `${name}#${service.namespace}/${method.method}:result`)}',`,
          `        create: ${resultSymbol}$schema,`,
          "      },",
          `      sourceLocation: ${JSON.stringify({ file, line: line.line, column: line.column })},`,
          "    },",
        ].join("\n"),
      );
    }
  }
  const model: ReflectionModel = reflectModel(
    services.map((service) => ({
      file: service.file,
      docNode: service.docNode,
      classNode: service.classNode,
      exportName: service.exportName,
      serviceKey: service.serviceKey,
      methods: service.methods.map((method) => ({
        method: method.method,
        node: method.node,
        typeNames: typeNamesOf.get(method.node) ?? [],
      })),
    })),
    index,
  );
  lines.push(
    "",
    "export const TYPERT: unknown = {",
    `  package: '${name}',`,
    `  face: '${face}',`,
    "  schemas: [",
    "  ],",
    "  invocations: [",
    ...invocations,
    "  ],",
    `  model: ${JSON.stringify(model, null, 2).replace(/\n/gu, "\n  ")},`,
    "}",
  );
  return `${lines.join("\n")}\n`;
}

/** 具名类型引用 → `<所属包出口>#<类型名>`（wire 上用类型符号标记编解码面）；内联类型返回 undefined。 */
function typeSymbolOf(type: Node | undefined, index: SchemaIndex): string | undefined {
  if (type === undefined || type["type"] !== "TSTypeReference") return undefined;
  const args = typeArgumentsOf(type);
  // `Promise<T>` / `AsyncIterable<T>`（stream 方法的返回）解包后再看：wire 上的类型就是 T。
  const outer = nameOf(type["typeName"] as Node);
  if ((outer === "Promise" || outer === "AsyncIterable") && args.length === 1) {
    return typeSymbolOf(args[0], index);
  }
  if (args.length > 0) return undefined;
  const name = nameOf(type["typeName"] as Node);
  if (name === undefined) return undefined;
  const declared = index.get(name);
  return declared === undefined ? undefined : `${declared.owner}#${name}`;
}

/** 某个包目录 + 声明文件 → `<包名><出口子路径>`（wire 的类型符号用它）。 */
async function ownerFor(pkgDir: string, file: string): Promise<string | undefined> {
  let manifest: { name?: string; exports?: Record<string, unknown> } | undefined;
  try {
    manifest = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as {
      name?: string;
      exports?: Record<string, unknown>;
    };
  } catch {
    return undefined;
  }
  const name = manifest.name;
  if (name === undefined) return undefined;
  // 声明文件在声明树里，包目录在上游，两者不共享前缀：按 `src/` 之后的尾部当包内路径。
  const sourceIndex = file.lastIndexOf(`${sep}src${sep}`);
  const relativePath =
    sourceIndex < 0
      ? ""
      : `./${file
          .slice(sourceIndex + 1)
          .split(sep)
          .join("/")}`;
  let subpath = "";
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    // 出口值是字符串或条件对象（`{ types, default }`）两种形态。
    const resolved =
      typeof value === "string"
        ? value
        : value !== null && typeof value === "object"
          ? ((value as Record<string, unknown>)["default"] ??
            (value as Record<string, unknown>)["types"])
          : undefined;
    if (key === "./package.json" || typeof resolved !== "string") continue;
    const target = resolved.replace(/\.ts$/u, "");
    if (relativePath === resolved || relativePath.startsWith(target)) {
      subpath = key === "." ? "" : key.replace(/^\./u, "");
      break;
    }
  }
  return `${name}${subpath}`;
}

/** 类型名 → 它的类型符号（`@pkg/出口#Name`）；索引里没有就交给调用方的兜底。 */
function symbolForName(name: string): string | undefined {
  const declared = indexForSymbols.get(name);
  return declared === undefined ? undefined : `${declared.owner}#${name}`;
}

/** 供 `symbolForName` 用的索引（每次 `generateTypert` 覆盖）。 */
let indexForSymbols: SchemaIndex = new Map();

/** 供跨包引用解析用的出口表 / 别名表（同样每次 `generateTypert` 覆盖）。 */
let surfaceExports = new Map<string, Map<string, { node: Node; file: string; text: string }>>();
type AliasEntry =
  | { pkg: string; name: string; namespace?: boolean }
  | { declared: { node: Node; file: string; text: string } };
let surfaceAliases = new Map<string, Map<string, AliasEntry>>();

/** 签名里把上下文参数换成 id 形态（`agent: Agent` → `agentId: SessionId`）。 */
function signatureParametersWithScopeId(method: RemoteMethod): string {
  const name = method.parameters.find(
    (parameter) => method.scope !== undefined && parameter.lookup === method.scope,
  )?.name;
  const replaced = `${String(method.scope)}Id: ${method.scopeIdType ?? "string"}`;
  if (name === undefined || method.signatureParameters === "") return replaced;
  return method.signatureParameters
    .split(", ")
    .map((part) => (part.startsWith(`${name}:`) || part.startsWith(`${name}?:`) ? replaced : part))
    .join(", ");
}

/** 签名里去掉上下文参数（`@RemoteScope` 的 ScopeMap 形态）。 */
function signatureParametersWithoutScope(method: RemoteMethod): string {
  // Context-only（`@RemoteScope`）的实现签名本来就不写 receiver，原样用。
  if (method.invocation === "context") return method.signatureParameters;
  const scopeParameterName = method.parameters.find(
    (parameter) => method.scope !== undefined && parameter.lookup === method.scope,
  )?.name;
  if (scopeParameterName === undefined || method.signatureParameters === "") return "";
  return method.signatureParameters
    .split(", ")
    .filter(
      (part) =>
        !part.startsWith(`${scopeParameterName}:`) && !part.startsWith(`${scopeParameterName}?:`),
    )
    .join(", ");
}

/**
 * 包的出口表与导入别名表：AST 路线要能替代 TS API，跨包引用就得自己解析。
 *
 * - 出口表：`包名 → 导出名 → 声明`（含 `export { A as B } from './x.ts'` 这类再导出与别名导出）；
 * - 别名表：`文件 → 本地名 → 目标（包 + 导出名 / default / 命名空间）`。
 *
 * 两者合起来就能把 `HostAgent`、`Host.Agent`、`import('@fixture/host').Agent` 这类写法指回真实声明。
 */
export async function packageSurfaces(
  packages: readonly { name: string; root: string }[],
): Promise<{
  exports: Map<string, Map<string, { node: Node; file: string; text: string }>>;
  aliases: Map<string, Map<string, AliasEntry>>;
}> {
  const exports = new Map<string, Map<string, { node: Node; file: string; text: string }>>();
  const aliases = new Map<string, Map<string, AliasEntry>>();
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg.root]));
  const entryByPkg = new Map<string, string>();
  for (const pkg of packages) {
    const candidates = [join(pkg.root, "src", "index.ts"), join(pkg.root, "src", "index.tsx")];
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        entryByPkg.set(pkg.name, candidate);
        break;
      }
    }
  }
  const collect = async (pkgName: string, file: string, seen: Set<string>): Promise<void> => {
    if (seen.has(file)) return;
    seen.add(file);
    const parsed = await parseFile(file);
    let table = exports.get(pkgName);
    if (table === undefined) {
      table = new Map();
      exports.set(pkgName, table);
    }
    // 同一个导出名可能既有类型又有值（`export type WorkspaceId` + `export function WorkspaceId`）：
    // wire 面要的是类型，类型优先，非类型只在没有类型时兜底。
    const put = (name: string, entry: { node: Node; file: string; text: string }): void => {
      const previous = table.get(name);
      if (
        previous !== undefined &&
        (isTypeDeclaration(previous.node) || !isTypeDeclaration(entry.node))
      ) {
        return;
      }
      table.set(name, entry);
    };
    for (const statement of parsed.program["body"] as Node[]) {
      if (statement["type"] === "ExportDefaultDeclaration") {
        const declaration = statement["declaration"] as Node;
        // `export default Service` / `export default class …`：引用形态要看它在本文件里的声明。
        const referenced = nameOf((declaration["typeName"] ?? declaration) as Node);
        const resolved =
          declaration["type"] === "TSTypeReference" || declaration["type"] === "Identifier"
            ? declarationIn(parsed.program, String(referenced))
            : declaration;
        put("default", {
          node: resolved ?? declaration,
          file,
          text: sliceOf(parsed.source, resolved ?? declaration),
        });
        continue;
      }
      if (statement["type"] === "ExportAllDeclaration") {
        const target = await resolveRelative(file, statement["source"]?.["value"]);
        if (target !== undefined) await collect(pkgName, target, seen);
        continue;
      }
      if (statement["type"] !== "ExportNamedDeclaration") continue;
      const source = statement["source"]?.["value"];
      const specifiers = (statement["specifiers"] ?? []) as Node[];
      if (typeof source === "string") {
        const target = await resolveRelative(file, source);
        if (target === undefined) continue;
        // 再导出：在目标文件里找被导出的名字（它自己可能也只是再导出，所以走递归）。
        for (const specifier of specifiers) {
          const local = nameOf(specifier["local"] as Node);
          const exported = nameOf(specifier["exported"] as Node) ?? local;
          if (local === undefined || exported === undefined) continue;
          // 目标文件里的名字：`export { A as B } from './x'` 里 A 是目标侧的名字，
          // 但不同解析器对 `local` / `exported` 的落位有出入，两边都试。
          const declared =
            (await exportedNode(target, local, new Set())) ??
            (await exportedNode(target, exported, new Set()));
          if (declared !== undefined) {
            put(exported, declared);
            put(local, declared);
          }
        }
        continue;
      }
      const declaration = statement["declaration"] as Node | null | undefined;
      if (declaration !== undefined && declaration !== null) {
        const declaredName = nameOf(declaration["id"] as Node);
        if (declaredName !== undefined) {
          put(declaredName, {
            node: declaration,
            file,
            text: sliceOf(parsed.source, declaration),
          });
        }
        continue;
      }
      // `export { A as B }`（本地别名）：A 就住在同一个文件里。
      for (const specifier of specifiers) {
        const local = nameOf(specifier["local"] as Node);
        const exported = nameOf(specifier["exported"] as Node) ?? local;
        if (local === undefined || exported === undefined) continue;
        const declared = declarationIn(parsed.program, local);
        if (declared !== undefined) {
          put(exported, { node: declared, file, text: sliceOf(parsed.source, declared) });
        }
      }
    }
  };
  for (const pkg of packages) {
    const entry = entryByPkg.get(pkg.name);
    if (entry !== undefined) await collect(pkg.name, entry, new Set());
  }

  for (const pkg of packages) {
    for (const file of await sourceFiles(pkg.root)) {
      const parsed = await parseFile(file);
      const table = new Map<string, AliasEntry>();
      for (const statement of parsed.program["body"] as Node[]) {
        if (statement["type"] !== "ImportDeclaration") continue;
        const source = statement["source"]?.["value"];
        if (typeof source !== "string") continue;
        // 跨包导入用包名当目标；同包的相对导入（`import { A as B } from './types.ts'`）记文件路径，
        // 解析时顺着那个文件找导出。
        const target = byName.has(source)
          ? source
          : ((await resolveRelative(file, source)) ?? undefined);
        if (target === undefined) continue;
        const isPackage = byName.has(target);
        for (const specifier of (statement["specifiers"] ?? []) as Node[]) {
          const local = nameOf(specifier["local"] as Node);
          if (local === undefined) continue;
          if (specifier["type"] === "ImportNamespaceSpecifier") {
            if (isPackage) table.set(local, { pkg: target, name: "*", namespace: true });
            continue;
          }
          const imported =
            specifier["type"] === "ImportDefaultSpecifier"
              ? "default"
              : (nameOf(specifier["imported"] as Node) ?? local);
          if (isPackage) {
            table.set(local, { pkg: target, name: imported });
            continue;
          }
          // 同包的相对导入：当场解析出目标声明（同文件的重命名导入也算跨包的一种）。
          const declared =
            imported === "default"
              ? ((await exportedNode(target, "default", new Set())) ?? undefined)
              : ((await exportedNode(target, imported, new Set())) ??
                (await exportedNode(target, local, new Set())) ??
                undefined);
          if (declared !== undefined) table.set(local, { declared });
        }
      }
      // key 用"仓库相对路径"的尾段：声明树与源码树是两份拷贝，绝对路径对不上。
      if (table.size > 0) aliases.set(packageRelative(file), table);
    }
  }
  return { exports, aliases };
}

/** 声明在源码里的原文切片。 */
function sliceOf(source: string, node: Node): string {
  const start = node["start"] as number | undefined;
  const end = node["end"] as number | undefined;
  return start === undefined || end === undefined ? "" : source.slice(start, end);
}

/**
 * 文件在仓库里的相对路径尾段（`<组>/<包>/src/x`）——两棵树共用这一个键。
 * 去掉扩展名：声明树里是 `x.d.ts`、源码树里是 `x.ts`，两边要用同一个键才连得起来。
 */
export function packageRelative(file: string): string {
  const marker = `${sep}packages${sep}`;
  const index = file.lastIndexOf(marker);
  const tail = index < 0 ? file : file.slice(index + marker.length);
  return tail.replace(/\.[jt]sx?$/u, "");
}

/** 相对说明符 → 绝对路径（`.ts` / `.tsx` / `/index.ts` 依次试）。 */
async function resolveRelative(fromFile: string, specifier: unknown): Promise<string | undefined> {
  if (typeof specifier !== "string" || !specifier.startsWith(".")) return undefined;
  const base = join(dirname(fromFile), specifier.replace(/\.[jt]sx?$/u, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

/**
 * 在文件里找某个导出的声明节点；找不到就顺着它的 `export … from` 再走一层（再导出的链可能不止一层：
 * `index.ts` → `types.ts` → `brand.ts`）。
 */
async function exportedNode(
  file: string,
  name: string,
  seen: Set<string>,
): Promise<{ node: Node; file: string; text: string } | undefined> {
  if (seen.has(file)) return undefined;
  seen.add(file);
  const parsed = await parseFile(file);
  const direct = declarationIn(parsed.program, name);
  if (direct !== undefined) return { node: direct, file, text: sliceOf(parsed.source, direct) };
  for (const statement of parsed.program["body"] as Node[]) {
    if (statement["type"] !== "ExportNamedDeclaration") continue;
    const source = statement["source"]?.["value"];
    if (typeof source !== "string") continue;
    const forwards = ((statement["specifiers"] ?? []) as Node[]).some((specifier) => {
      const local = nameOf(specifier["local"] as Node);
      const exported = nameOf(specifier["exported"] as Node) ?? local;
      return local === name || exported === name;
    });
    if (!forwards) continue;
    const target = await resolveRelative(file, source);
    if (target === undefined) continue;
    const found = await exportedNode(target, name, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 在文件里找某个顶层声明的声明节点。 */
function declarationIn(program: Node, name: string): Node | undefined {
  // 同名可能既有类型又有值（`export type AttachmentId = …` + `export function AttachmentId(…)`）：
  // wire 面要类型，类型优先。
  let found: Node | undefined;
  let foundType = false;
  for (const statement of program["body"] as Node[]) {
    if (statement["type"] === "ExportNamedDeclaration" && statement["declaration"] != null) {
      const declaration = statement["declaration"] as Node;
      if (declaration["id"] != null && nameOf(declaration["id"] as Node) === name) {
        if (!foundType || isTypeDeclaration(declaration)) {
          found = declaration;
          foundType = isTypeDeclaration(declaration);
        }
      }
      continue;
    }
    // 只有带 `id` 的声明才算（`export default …`、`import …` 这些没有 id）。
    const declaration = statement as Node;
    if (declaration["id"] !== undefined && nameOf(declaration["id"] as Node) === name) {
      if (!foundType || isTypeDeclaration(declaration)) {
        found = declaration;
        foundType = isTypeDeclaration(declaration);
      }
    }
  }
  return found;
}

function lineOf(file: ParsedFile, node: Node): { line: number; column: number } {
  const start = typeof node["start"] === "number" ? (node["start"] as number) : 0;
  const before = file.source.slice(0, start).split("\n");
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}
