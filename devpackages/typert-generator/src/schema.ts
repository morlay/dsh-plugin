import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
import { type Node, nameOf, parseFile, typeArgumentsOf } from "./ast.ts";

// `ts 2 schema`：把 TypeScript 的**类型语法**翻成 zod 表达式文本。
//
// 为什么只要语法：typert 产物是"wire 编解码面"的声明式描述，类型引用在声明树（`target/dts`）里本来
// 就是摊平的（interface / type / enum 都在），所以不需要类型检查器，oxc 的 AST 足够——也正因为这样
// 这一步不依赖任何 TypeScript 版本。
//
// 产物的形状照上游一致：每个参数 / 结果类型一个具名 schema
// （`let X$schema$value` + `const X$schema = () => (X$schema$value ??= <zod>)`），嵌套类型就地展开，
// 只有**递归**的类型才提到顶层具名、用 `z.lazy(() => X$schema())` 自引用。

export type TypeDecl = {
  name: string;
  file: string;
  node: Node;
  /** 声明原文（含 `export`）。 */
  text: string;
  /** 所属包出口，形如 `@deepseek-ai/dsh-x/types`（wire 上的类型符号要它）。 */
  owner: string;
};

export type SchemaIndex = Map<string, TypeDecl>;

/** 扫声明树建索引：顶层 interface / type / enum / class 都进表（同名后者覆盖，声明树里不会重名）。 */
export type SchemaIndexOptions = {
  /**
   * 声明文件 → 所属包出口（`@deepseek-ai/dsh-x/types`）。声明树只是声明的副本，里面没有 `package.json`，
   * 所以包名得由调用方按仓库布局解析；缺省时按"声明文件同目录向上找 package.json"。
   */
  ownerOf?: (file: string) => Promise<string | undefined>;
};

export async function buildSchemaIndex(
  dtsRoot: string,
  options: SchemaIndexOptions = {},
): Promise<SchemaIndex> {
  const index: SchemaIndex = new Map();
  const owners = new Map<string, string>();
  for (const file of await dtsFiles(dtsRoot)) {
    const parsed = await parseFile(file);
    const owner = (await options.ownerOf?.(file)) ?? (await ownerOf(file, owners));
    for (const statement of parsed.program["body"] as Node[]) {
      const declaration =
        statement["type"] === "ExportNamedDeclaration" && statement["declaration"] !== null
          ? (statement["declaration"] as Node)
          : statement["type"] === "ExportDefaultDeclaration"
            ? (statement["declaration"] as Node)
            : statement;
      const name = nameOf(declaration["id"] as Node | undefined);
      if (name === undefined) continue;
      if (
        declaration["type"] === "TSInterfaceDeclaration" ||
        declaration["type"] === "TSTypeAliasDeclaration" ||
        declaration["type"] === "TSEnumDeclaration" ||
        declaration["type"] === "ClassDeclaration"
      ) {
        // 同名类型可能出现在同包的多个声明文件里（`src/types.ts` 是定义、`src/control.ts` 可能只是一段
        // 再导出）：保留**带出口子路径**的那份，`typeSymbol` 才指得准（registry 按它找 schema）。
        const previous = index.get(name);
        if (previous !== undefined && (previous.owner.includes("/") || !owner.includes("/"))) continue;
        index.set(name, {
          name,
          file,
          owner,
          node: declaration,
          // 反射里 `types[].declaration` 用的是声明原文，从 `export` 起算。
          text: parsed.source.slice(statement["start"] as number, declaration["end"] as number),
        });
      }
    }
  }
  return index;
}

/** 声明文件所属包出口：从声明树里的相对位置反推包目录，再按 `exports` 找出口子路径。 */
async function ownerOf(file: string, cache: Map<string, string>): Promise<string> {
  let dir = dirname(file);
  for (let depth = 0; depth < 5; depth += 1) {
    const manifestPath = join(dir, "package.json");
    const cached = cache.get(dir);
    if (cached !== undefined) return cached;
    if (await pathExists(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        name?: string;
        exports?: Record<string, unknown>;
      };
      const name = manifest.name ?? "";
      const relativeFile = relative(dir, file).split(sep).join("/");
      let subpath = "";
      for (const [key, value] of Object.entries(manifest.exports ?? {})) {
        const target = typeof value === "string" ? value : undefined;
        if (target === undefined || key === "./package.json") continue;
        if (
          `./${relativeFile}`.startsWith(target.replace(/\.ts$/u, "")) ||
          target === `./${relativeFile}`
        ) {
          subpath = key === "." ? "" : key.replace(/^\./u, "");
          break;
        }
      }
      const owner = `${name}${subpath}`;
      cache.set(dir, owner);
      return owner;
    }
    dir = dirname(dir);
  }
  return "";
}

async function dtsFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        await walk(full);
      } else if (entry.name.endsWith(".d.ts")) {
        found.push(full);
      } else if (entry.name.endsWith(".ts")) {
        // 声明树里的源码形态（上游 generator 的 fixtures 就是源码树：类型与实现同居一文件）。
        found.push(full);
      }
    }
  }
  await walk(root);
  return found.sort();
}

function literalText(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** 一个文件里正在展开的类型栈：命中即"递归"，走具名 + `z.lazy`。 */
type EmitContext = {
  index: SchemaIndex;
  stack: Set<string>;
  /** 这次 schema 里引用到的自定义类型名（反射的 `types` 用）。 */
  referenced: Set<string>;
  /** 递归类型提到顶层的具名 schema：名字 → zod 定义（产物里 `let X$schema$value` 那一对）。 */
  named: Map<string, string>;
};

/** 类型注解 AST（或类型节点）→ zod 表达式文本。 */
export function zodOf(node: Node | undefined, context: EmitContext): string {
  if (node === undefined) return "z.unknown()";
  switch (node["type"] as string) {
    case "TSStringKeyword":
      return "z.string()";
    case "TSNumberKeyword":
      return "z.number()";
    case "TSBooleanKeyword":
      return "z.boolean()";
    case "TSVoidKeyword":
      return "z.void()";
    case "TSUndefinedKeyword":
      return "z.undefined()";
    case "TSUnknownKeyword":
    case "TSAnyKeyword":
      return "z.unknown()";
    case "TSNeverKeyword":
      return "z.never()";
    case "TSNullKeyword":
      return "z.literal(null)";
    case "TSLiteralType":
      return `z.literal(${literalText((node["literal"] as Node)["value"])})`;
    case "TSArrayType":
      return `z.array(${zodOf(node["elementType"] as Node, context)})`;
    case "TSParenthesizedType":
      return zodOf(node["typeAnnotation"] as Node, context);
    case "TSTypeOperator":
      // `readonly T[]` 这类类型操作符只影响类型系统：wire 形状就是内层，不加修饰符
      // （`readonly` 属性的 `.readonly()` 由属性签名那边落）。
      return zodOf(node["typeAnnotation"] as Node, context);
    case "TSUnionType": {
      // 不折叠成 `.nullable()`：产物里 null 就是 union 的一个分支——但它**排最前**（上游的稳定顺序），
      // 其余分支保持源码顺序。
      const flat: Node[] = [];
      const collect = (parts: readonly Node[]): void => {
        for (const part of parts) {
          if (part["type"] === "TSUnionType") collect(part["types"] as Node[]);
          else flat.push(part);
        }
      };
      collect(node["types"] as Node[]);
      const ordered = [...flat].sort(
        (left, right) =>
          Number(right["type"] === "TSNullKeyword") - Number(left["type"] === "TSNullKeyword"),
      );
      // 引用链带来的嵌套（`A | B` 里 A 又是 union）在字符串层再展平一次：产物里 union 永远是一层。
      const parts = ordered.flatMap((part) => flattenUnion(zodOf(part, context)));
      return parts.length === 1 ? (parts[0] as string) : `z.union([${parts.join(", ")}])`;
    }
    case "TSIntersectionType":
      // brand 标记（`T & { readonly BRAND: B }`）折叠成 `z.unknown()`：它只是编译期的名义标记，wire 上没有形状。
      return `z.intersection(${(node["types"] as Node[])
        .map((part) => (isBrandMarker(part) ? "z.unknown()" : zodOf(part, context)))
        .join(", ")})`;
    case "TSTypeLiteral":
      return objectOf(node["members"] as Node[], context);
    case "TSIndexedAccessType": {
      // `T['field']`：顺着引用找到 T 的声明，取那个字段的类型（上游也是就地展开）。
      const object = node["objectType"] as Node;
      const key = node["indexType"] as Node;
      const name = object["type"] === "TSTypeReference" ? nameOf(object["typeName"] as Node) : undefined;
      const declared = name === undefined ? undefined : context.index.get(name);
      const members = (declared?.node["body"]?.["body"] ?? []) as Node[];
      // 索引访问也能自引用（`T = T['k']`），所以和引用一样过一遍展开栈。
      const guard = `${String(name)} ${key["type"] === "TSTypeOperator" ? String(key["operator"]) : String(nameOf(key) ?? key["literal"]?.["value"])}`;
      if (context.stack.has(guard)) return "z.unknown()";
      context.stack.add(guard);
      try {
      // `T[keyof T]`：取所有字段值类型的 union（`ModelModality` 就是这种写法）。
      if (key["type"] === "TSTypeOperator" && key["operator"] === "keyof") {
        const values = members
          .filter((member) => member["type"] === "TSPropertySignature")
          .map((member) => zodOf(member["typeAnnotation"]?.["typeAnnotation"] as Node, context));
        const unique = [...new Set(values)];
        return unique.length === 1 ? (unique[0] as string) : `z.union([${unique.join(", ")}])`;
      }
      const field =
        nameOf(key) ??
        (key["type"] === "TSLiteralType"
          ? String(key["literal"]?.["value"])
          : typeof key["value"] === "string"
            ? key["value"]
            : undefined);
      const target = members.find((member) => nameOf(member["key"] as Node) === field);
      if (target === undefined) return `z.unknown() /* 未解析 ${String(name)}[${String(field)}] */`;
      let value = zodOf(target["typeAnnotation"]?.["typeAnnotation"] as Node, context);
      if (target["optional"] === true) value += ".optional()";
      if (target["readonly"] === true) value += ".readonly()";
      return value;
      } finally {
        context.stack.delete(guard);
      }
    }
    case "TSTypeReference":
      return referenceOf(node, context);
    case "TSEnumDeclaration":
      return enumOf(node);
    default:
      return `z.unknown() /* TODO ${String(node["type"])} */`;
  }
}

/** 把 `z.union([...])` 拆成它的分支（顶层逗号切分），非 union 原样返回。 */
function flattenUnion(text: string): string[] {
  const match = /^z\.union\(\[(.*)\]\)$/su.exec(text);
  if (match === null) return [text];
  const body = match[1] ?? "";
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts.flatMap((part) => flattenUnion(part));
}

function isBrandMarker(node: Node): boolean {
  if (node["type"] !== "TSTypeLiteral") return false;
  const members = (node["members"] ?? []) as Node[];
  return members.length === 1 && nameOf(members[0]?.["key"] as Node | undefined) === "BRAND";
}

function enumOf(node: Node): string {
  const values: string[] = [];
  // oxc：`TSEnumDeclaration.body.members`。
  for (const member of (node["body"]?.["members"] ?? node["members"] ?? []) as Node[]) {
    const value = member["initializer"] as Node | null;
    values.push(
      `z.literal(${value === null ? JSON.stringify(nameOf(member["id"] as Node)) : literalText(value["value"])})`,
    );
  }
  return values.length === 1 ? (values[0] as string) : `z.union([${values.join(", ")}])`;
}

function objectOf(members: Node[], context: EmitContext): string {
  const fields: string[] = [];
  for (const member of members) {
    if (member["type"] === "TSIndexSignature") {
      // `[key: string]: T` → `z.record(z.string(), T)`
      const parameter = (member["parameters"] as Node[])[0];
      const key = zodOf(parameter?.["typeAnnotation"]?.["typeAnnotation"] as Node, context);
      const value = zodOf(member["typeAnnotation"]?.["typeAnnotation"] as Node, context);
      return `z.record(${key}, ${value})`;
    }
    if (member["type"] !== "TSPropertySignature") continue;
    const key = nameOf(member["key"] as Node) ?? literalText((member["key"] as Node)["value"]);
    let value = zodOf(member["typeAnnotation"]?.["typeAnnotation"] as Node, context);
    // 顺序固定：`.readonly()` 先、`.optional()` 后（上游产物就是这么落的）。
    if (member["readonly"] === true) value += ".readonly()";
    if (member["optional"] === true) value += ".optional()";
    fields.push(`  '${key}': ${value},`);
  }
  return `z.object({\n${fields.join("\n")}\n})`;
}

const BUILTIN: Record<string, (args: Node[], context: EmitContext) => string> = {
  Promise: (args, context) => zodOf(args[0], context),
  AsyncIterable: (args, context) => zodOf(args[0], context),
  Array: (args, context) => `z.array(${zodOf(args[0], context)})`,
  ReadonlyArray: (args, context) => `z.array(${zodOf(args[0], context)}).readonly()`,
  Record: (args, context) => `z.record(${zodOf(args[0], context)}, ${zodOf(args[1], context)})`,
};

function referenceOf(node: Node, context: EmitContext): string {
  const name = nameOf(node["typeName"] as Node);
  const args = typeArgumentsOf(node);
  if (name === undefined) return "z.unknown()";
  const builtin = BUILTIN[name];
  if (builtin !== undefined) return builtin(args, context);
  context.referenced.add(name);
  const declared = context.index.get(name);
  if (declared === undefined) return `z.unknown() /* 未解析 ${name} */`;
  if (context.stack.has(name)) {
    // 递归：类型提到顶层具名，引用处走 `z.lazy` 自引用（先占位再展开，展开里再遇到自己就走这条）。
    const symbol = `${name}RemoteCodec`;
    if (!context.named.has(symbol)) {
      context.named.set(symbol, "");
      const declaredSelf = context.index.get(name);
      const definition =
        declaredSelf?.node["type"] === "TSTypeAliasDeclaration"
          ? zodOf(declaredSelf.node["typeAnnotation"] as Node, context)
          : zodOf(
              { type: "TSTypeLiteral", members: (declaredSelf?.node["body"]?.["body"] ?? []) as Node[] },
              context,
            );
      context.named.set(symbol, definition);
    }
    return `z.lazy(() => ${symbol}$schema())`;
  }
  context.stack.add(name);
  const inner =
    declared.node["type"] === "TSTypeAliasDeclaration"
      ? zodOf(declared.node["typeAnnotation"] as Node, context)
      : declared.node["type"] === "TSEnumDeclaration"
        ? enumOf(declared.node)
        : objectOf((declared.node["body"]?.["body"] ?? []) as Node[], context);
  context.stack.delete(name);
  return inner;
}

export function newContext(index: SchemaIndex): EmitContext {
  return { index, stack: new Set(), referenced: new Set(), named: new Map() };
}
