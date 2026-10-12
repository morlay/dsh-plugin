import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import {
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
 * 上下文查找表：`declare module '@deepseek-ai/dsh-typert-protocol'` 里的
 * `TypertLookupMap { agent: TypertLookup<Agent, AgentId> }` / `TypertContextMap { agent: TypertContext<AgentId> }`。
 *
 * wire 上的"上下文参数"（descriptor 的 `scope`）就是从这里来的：参数的**类型**在这张表里时，它按 lookup 传、
 * 而不是当 JSON 载荷，wire 名取 id 类型的小驼峰（`AgentId` → `agentId`）。
 */
async function lookupContexts(
  packages: readonly { name: string; root: string }[],
): Promise<Map<string, { idType: string; objectType: string | undefined }>> {
  const table = new Map<string, { idType: string; objectType: string | undefined }>();
  // 类型实参是引用节点（名字在 `typeName` 上）。
  const argumentName = (argument: Node | undefined): string | undefined =>
    argument === undefined ? undefined : nameOf((argument["typeName"] ?? argument) as Node);
  for (const pkg of packages) {
    for (const file of await sourceFiles(pkg.root)) {
      const parsed = await parseFile(file);
      walkAll(parsed.program, (node) => {
        if (node["type"] !== "TSInterfaceDeclaration") return;
        const interfaceName = nameOf(node["id"] as Node);
        if (interfaceName !== "TypertLookupMap" && interfaceName !== "TypertContextMap") return;
        for (const member of (node["body"]?.["body"] ?? []) as Node[]) {
          if (member["type"] !== "TSPropertySignature") continue;
          const key = nameOf(member["key"] as Node);
          const annotation = member["typeAnnotation"]?.["typeAnnotation"] as Node | undefined;
          if (key === undefined || annotation === undefined) continue;
          const args = typeArgumentsOf(annotation);
          const idType = argumentName(args.at(-1));
          const objectType = interfaceName === "TypertLookupMap" ? argumentName(args[0]) : undefined;
          if (idType === undefined) continue;
          // `TypertLookupMap` 给"对象 → id"的对照（`agent: TypertLookup<Agent, SessionId>`），
          // `TypertContextMap` 只给 id；两张表都注册同一个键时，保留带对象名的那条。
          const previous = table.get(key);
          table.set(key, { idType, objectType: objectType ?? previous?.objectType });
        }
      });
    }
  }
  return table;
}

export type GenerateOptions = {
  /** 上游 clone 的根目录（`<vendor>/<name>`）：产物里的 `sourceLocation.file` 相对它。 */
  upstreamRoot: string;
  /** 声明树根（`<root>/target/dts`），布局见 `devpackages/devkit/src/dts-project.ts`。 */
  dtsRoot: string;
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
  /** 声明面签名用的参数文本（含被 wire 跳过的 `signal`）。 */
  signatureParameters: string;
  parameters: {
    name: string;
    type: Node | undefined;
    optional: boolean;
    node: Node;
    /** 由查找表补出来的上下文参数：它的 codec 用 id 类型而不是参数注解。 */
    idType?: string;
  }[];
  /** 取消通道参数名（`signal: AbortSignal`）：wire 上不传，但 invocation 要记下来。 */
  cancellation?: string;
  /** 上下文名：来自 `@RemoteScope('<context>')`，或参数类型命中 `TypertLookupMap` / `TypertContextMap`。 */
  scope?: string;
  scopeWire?: string;
  scopeIdType?: string;
  scopeParameter?: Node;
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
function remoteOptionsOf(member: Node): { wireName?: string; scope?: string; mode: "direct" | "stream" } {
  let wireName: string | undefined;
  let scope: string | undefined;
  let mode: "direct" | "stream" = "direct";
  for (const decorator of (member["decorators"] ?? []) as Node[]) {
    const expression = decorator["expression"] as Node;
    if (nameOf((expression["callee"] ?? expression) as Node) === "RemoteScope") {
      // `@RemoteScope('<ctx>')` 的参数是上下文名，**不是** wire 名：它不参与下面的 wireName 判定。
      const first = ((expression["arguments"] ?? []) as Node[])[0];
      if (first?.["type"] === "Literal" && typeof first["value"] === "string") {
        scope = first["value"];
      }
      continue;
    }
    const args = ((expression["arguments"] ?? []) as Node[]).filter(
      (argument) => argument["type"] !== "SpreadElement",
    );
    for (const argument of args) {
      if (argument["type"] === "Literal" && typeof argument["value"] === "string") {
        wireName = argument["value"];
      } else if (argument["type"] === "ObjectExpression") {
        for (const property of argument["properties"] as Node[]) {
          if (nameOf(property["key"] as Node) === "mode" && property["value"]?.["value"] === "stream") {
            mode = "stream";
          }
        }
      }
    }
  }
  return { ...(wireName === undefined ? {} : { wireName }), ...(scope === undefined ? {} : { scope }), mode };
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
        nameOf((parameter["typeAnnotation"]?.["typeAnnotation"] as Node)?.["typeName"] as Node | undefined) ===
        "AbortSignal";
      return isCancellation && !text.includes("?") ? text.replace(":", "?:") : text;
    })
    .join(", ");
}

/** 参数的 schema：可选参数（`options?`）在 wire 上是 `undefined | T`，`undefined` 排最前。 */
function schemaOfParameter(
  parameter: { type: Node | undefined; optional: boolean },
  context: Parameters<typeof zodOf>[1],
): string {
  const inner = zodOf(parameter.type, context);
  return parameter.optional ? `z.union([z.undefined(), ${inner}])` : inner;
}

function isRemoteDecorated(member: Node): boolean {
  return ((member["decorators"] ?? []) as Node[]).some((decorator) => {
    const expression = decorator["expression"] as Node;
    const name = nameOf((expression["callee"] ?? expression) as Node);
    return name === "Remote" || name === "RemoteScope";
  });
}

function remoteMethodsOf(
  klass: Node,
  source: string,
  contexts: Map<string, { idType: string; objectType: string | undefined }>,
): RemoteMethod[] {
  const methods: RemoteMethod[] = [];
  for (const member of (klass["body"]?.["body"] ?? []) as Node[]) {
    if (member["type"] !== "MethodDefinition" || !isRemoteDecorated(member)) continue;
    const declaredParameters = (member["value"]?.["params"] ?? []) as Node[];
    const isCancellation = (parameter: Node): boolean =>
      nameOf(
        (parameter["typeAnnotation"]?.["typeAnnotation"] as Node)?.["typeName"] as Node | undefined,
      ) === "AbortSignal";
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
    // 参数类型落在上下文查找表里 → 它是 scope 参数（wire 上按 lookup 传、名字用 id 类型）。
    const scopeHit = declaredParameters
      .map((parameter) => {
        const typeName = nameOf(
          (parameter["typeAnnotation"]?.["typeAnnotation"] as Node)?.["typeName"] as Node | undefined,
        );
        if (typeName === undefined) return undefined;
        for (const [key, entry] of contexts) {
          if (entry.objectType === typeName || entry.idType === typeName) {
            return { key, wire: `${key}Id`, idType: entry.idType, parameter };
          }
        }
        return undefined;
      })
      .find((hit) => hit !== undefined);
    // 参数类型命中查找表 → 该参数就是上下文参数（wire 上用 id 类型，不是宿主对象）。
    const scopedParameter =
      scopeHit === undefined
        ? undefined
        : parameters.find((candidate) => candidate.node === scopeHit.parameter);
    if (scopedParameter !== undefined && scopeHit !== undefined) {
      scopedParameter.idType = scopeHit.idType;
    }
    const options = remoteOptionsOf(member);
    // `@RemoteScope('<key>')` 的方法在 wire 上自带一个上下文参数（即使实现里没写它）：
    // 名字用上下文键，类型用查找表里的 id 类型。
    const scopeEntry = options.scope === undefined ? undefined : contexts.get(options.scope);
    if (options.scope !== undefined && scopeHit === undefined && scopeEntry !== undefined) {
      parameters.unshift({
        name: options.scope,
        type: undefined,
        optional: false,
        node: member,
        idType: scopeEntry.idType,
      });
    }
    const implementation = String(nameOf(member["key"] as Node) ?? "");
    const method = options.wireName ?? implementation;
    methods.push({
      method,
      ...(method === implementation ? {} : { implementation }),
      mode: options.mode,
      ...(options.scope === undefined && scopeHit === undefined
        ? {}
        : { scope: options.scope ?? scopeHit?.key ?? "" }),
      ...(scopeHit === undefined
        ? {}
        : {
            scopeWire: `${scopeHit.key}Id`,
            scopeIdType: scopeHit.idType,
            scopeParameter: scopeHit.parameter,
          }),
      signatureParameters: signatureParametersOf(source, member),
      parameters,
      ...(cancellation === undefined
        ? {}
        : { cancellation: String(nameOf(cancellation["name"] as Node) ?? "signal") }),
      result: member["value"]?.["returnType"]?.["typeAnnotation"] as Node | undefined,
      node: member,
    });
  }
  return methods.sort((left, right) => left.method.localeCompare(right.method));
}

/** 服务类：`extends TypertRemoteService`。 */
function servicesOf(
  file: ParsedFile,
  contexts: Map<string, { idType: string; objectType: string | undefined }>,
): RemoteService[] {
  const found: RemoteService[] = [];
  for (const statement of file.program["body"] as Node[]) {
    // `export class X` / `export default class X` / 裸 `class X` 三种都要认。
    const declaration = unwrapExport(statement);
    if (declaration["type"] !== "ClassDeclaration") continue;
    const methods = remoteMethodsOf(declaration, file.source, contexts);
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

async function packageDirs(upstreamRoot: string): Promise<string[]> {
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
  const contexts = await lookupContexts(discovered);
  const owners = new Map<string, string | undefined>();
  const index = await buildSchemaIndex(options.dtsRoot, {
    // 声明树里的位置 `<dtsRoot>/<仓库相对路径>` 就是包目录的位置，包名仍从上游清单读。
    ownerOf: async (file) => {
      // 声明树按仓库根布局（`<dtsRoot>/<仓库相对路径>`），从 dtsRoot 反推仓库根就得到真实路径；
      // 包根按路径里的 `src/` 段切——声明可能住在 `src/<子目录>/…`，数目录层级会数错。
      const repoRoot = dirname(dirname(options.dtsRoot));
      const absolute = join(repoRoot, relative(options.dtsRoot, file));
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
      services.push(...servicesOf(await parseFile(file), contexts));
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
        const context = newContext(index);
        lines.push(
          `let ${symbol}$schema$value`,
          `const ${symbol}$schema = () => (${symbol}$schema$value ??= ${schemaOfParameter(parameter, context)})`,
        );
        collectOwners(context.referenced, index, typeRefs);
        flushNamedRemote(context);
        return { parameter, symbol };
      });
      const resultSymbol = `${prefix}_result`;
      const resultContext = newContext(index);
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
          "      invocation: { kind: 'direct' },",
          // 上下文参数（`@RemoteScope` 或类型命中查找表）：descriptor 记 scope，参数按 lookup 传。
          ...(method.scope === undefined
            ? []
            : [
                "      scope: {",
                `        context: '${method.scope}',`,
                `        wire: '${method.scopeWire ?? `${method.scope}Id`}',`,
                "      },",
              ]),
          "      parameters: [",
          ...parameters.map(({ parameter, symbol }) =>
            [
              "        {",
              `          name: '${parameter.name}',`,
              // `@RemoteScope` 的第一个参数是上下文：wire 名带 Id、按查找传，而不是当 JSON 载荷。
              ...(parameter.idType !== undefined ||
              (method.scopeParameter !== undefined && method.scopeParameter === parameter.node)
                ? [
                    `          wire: '${method.scopeWire ?? `${method.scope}Id`}',`,
                    "          source: 'lookup',",
                    `          lookup: '${method.scope}',`,
                  ]
                : [`          wire: '${parameter.name}',`, "          source: 'json',"]),
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
    for (const method of service.methods) {
      lines.push(`    ${method.method}: ${signatureFor(method, service.file.source, method.scope !== undefined)}`);
    }
    lines.push("  }");
  }
  lines.push("  interface TypertRemoteMap {");
  for (const service of services) {
    for (const method of service.methods) {
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
        const context = newContext(index);
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
      const resultContext = newContext(index);
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
          "      invocation: { kind: 'direct' },",
          // `@RemoteScope('<ctx>')`：首个参数按上下文查找传（不是 JSON），wire 名带 Id。
          ...(method.scope === undefined
            ? []
            : [
                "      scope: {",
                `        context: '${method.scope}',`,
                `        wire: '${method.scopeWire ?? `${method.scope}Id`}',`,
                "      },",
              ]),
          "      parameters: [",
          ...parameters.map(({ parameter, symbol }) =>
            [
              "        {",
              `          name: '${parameter.name}',`,
              // `@RemoteScope` 的第一个参数是上下文：wire 名带 Id、按查找传，而不是当 JSON 载荷。
              ...(parameter.idType !== undefined ||
              (method.scopeParameter !== undefined && method.scopeParameter === parameter.node)
                ? [
                    `          wire: '${method.scopeWire ?? `${method.scope}Id`}',`,
                    "          source: 'lookup',",
                    `          lookup: '${method.scope}',`,
                  ]
                : [`          wire: '${parameter.name}',`, "          source: 'json',"]),
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

/** 签名里把上下文参数换成 id 形态（`agent: Agent` → `agentId: SessionId`）。 */
function signatureParametersWithScopeId(method: RemoteMethod): string {
  const name = method.parameters.find(
    (parameter) => parameter.idType !== undefined || parameter.node === method.scopeParameter,
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
  const scopeParameterName = method.parameters.find(
    (parameter) => parameter.idType !== undefined || parameter.node === method.scopeParameter,
  )?.name;
  if (scopeParameterName === undefined || method.signatureParameters === "") return "";
  return method.signatureParameters
    .split(", ")
    .filter((part) => !part.startsWith(`${scopeParameterName}:`) && !part.startsWith(`${scopeParameterName}?:`))
    .join(", ");
}

function lineOf(file: ParsedFile, node: Node): { line: number; column: number } {
  const start = typeof node["start"] === "number" ? (node["start"] as number) : 0;
  const before = file.source.slice(0, start).split("\n");
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}
