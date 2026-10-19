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
import { isTypeDeclaration, type Node, nameOf, parseFile, typeArgumentsOf } from "./ast.ts";

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
        if (previous !== undefined && (previous.owner.includes("/") || !owner.includes("/")))
          continue;
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

/**
 * 字面量节点的**源码文本**（`z.literal(...)` 的参数）。
 *
 * oxc 里三种形态都出现过：负数是一元表达式（`-2` → `UnaryExpression{operator:'-', argument:Literal}`）、
 * 无替换的模板字面量是 `TemplateLiteral`、其余是 `Literal`（`raw` 保真：`-2n` / `'ready'`）。
 */
function literalSourceOf(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node["type"] === "UnaryExpression") {
    const inner = literalSourceOf(node["argument"] as Node | undefined);
    return inner === undefined ? undefined : `${String(node["operator"])}${inner}`;
  }
  if (node["type"] === "TemplateLiteral") {
    if (((node["expressions"] ?? []) as Node[]).length > 0) return undefined;
    const raw = (((node["quasis"] ?? []) as Node[])[0]?.["value"] as Node | undefined)?.["raw"];
    return typeof raw === "string" ? JSON.stringify(raw) : undefined;
  }
  const raw = node["raw"];
  if (typeof raw === "string") return raw;
  const value = node["value"];
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return `${String(value)}n`;
  if (typeof value === "boolean") return String(value);
  return value === null ? "null" : undefined;
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
  /** 当前文件：解析导入别名 / 命名空间限定名时要它（展开跨文件声明时会临时切换）。 */
  file: string | undefined;
  /** 泛型形参 → 实参节点（展开定义时由引用处的实参代入；无实参时用形参默认值）。 */
  typeArguments: Map<string, Node>;
  /** 包的出口表：`包名 → 导出名 → 声明`（解析跨包引用用）。 */
  exports?: Map<string, Map<string, { node: Node; file: string; text: string }>>;
  /** 导入别名表：`文件 → 本地名 → 目标（包 + 导出名 / default / 命名空间）`。 */
  aliases?: Map<
    string,
    Map<
      string,
      | { pkg: string; name: string; namespace?: boolean }
      | { declared: { node: Node; file: string; text: string } }
    >
  >;
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
    case "TSLiteralType": {
      const text = literalSourceOf(node["literal"] as Node);
      return text === undefined ? "z.unknown() /* TODO 未知字面量形态 */" : `z.literal(${text})`;
    }
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
      return objectOf(
        ((node["members"] ?? []) as Node[]).map((member) => ({ node: member, file: context.file })),
        context,
      );
    case "TSIndexedAccessType": {
      // `T['field']`：顺着引用找到 T 的声明，取那个字段的类型（上游也是就地展开）。
      const object = node["objectType"] as Node;
      const key = node["indexType"] as Node;
      // 映射类型的索引访问（`{ [K in U]: V }[U]`）：U 是 declare-merge 的开放集合时（如
      // `TypertResourceKind` = `Extract<keyof TypertResourceMap, string>`），成员只在**完整程序**里合并出来，
      // 而声明树按文件摊开、看不到合并结果。上游由类型检查器求值，这条 AST 路线求不了，兜底 `unknown`
      // （宽松，不拒合法值）。
      if (object["type"] === "TSMappedType") return "z.unknown() /* TODO 映射类型索引访问 */";
      const name =
        object["type"] === "TSTypeReference" ? nameOf(object["typeName"] as Node) : undefined;
      const declared = name === undefined ? undefined : context.index.get(name);
      const members = membersOf(declared, context);
      // 索引访问也能自引用（`T = T['k']`），所以和引用一样过一遍展开栈。
      const guard = `${String(name)}|${key["type"] === "TSTypeOperator" ? String(key["operator"]) : String(nameOf(key) ?? key["literal"]?.["value"])}`;
      if (context.stack.has(guard)) return "z.unknown()";
      context.stack.add(guard);
      try {
        // `T[keyof T]`：取所有字段值类型的 union（`ModelModality` 就是这种写法）。
        if (key["type"] === "TSTypeOperator" && key["operator"] === "keyof") {
          const values = members
            .filter((member) => member.node["type"] === "TSPropertySignature")
            .map((member) => {
              context.file = member.file ?? context.file;
              return zodOf(member.node["typeAnnotation"]?.["typeAnnotation"] as Node, context);
            });
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
        const target = members.find((member) => nameOf(member.node["key"] as Node) === field);
        if (target === undefined) {
          throw new Error(
            `索引访问解析失败：${String(name)}[${String(field)}] ` +
              `@ ${String(context.file)}#${String(node["start"])} ` +
              `objectType=${String(object["type"])} indexType=${String(key["type"])}`,
          );
        }
        context.file = target.file ?? context.file;
        let value = zodOf(target.node["typeAnnotation"]?.["typeAnnotation"] as Node, context);
        if (target.node["optional"] === true) value += ".optional()";
        if (target.node["readonly"] === true) value += ".readonly()";
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

/**
 * 一条字段 + 它所在的声明文件：继承来的字段要用**基接口那份文件**的导入别名表渲染，所以文件得跟着成员走。
 */
export type MemberRef = { readonly node: Node; readonly file: string | undefined };

/**
 * 一个具名声明（interface / type literal）的**全部字段**：自身成员 + `extends` 基接口的成员（递归，同名以
 * 自身为准，环上停住）。
 *
 * 继承来的字段同样是"这个对象上的字段"。漏掉它们的代价不是类型不准，而是**线上丢参数**：
 * `SessionSelectModelRequest extends ModelSelection` 的 `provider` / `model` 就这样在服务端反序列化时被
 * 丢掉，`requireModel` 拿到 `provider === undefined`（`no adapter registered for provider "undefined"`），
 * 界面上的表现是"模型列得出来、点选报 `session/model-unavailable`"。
 */
export function membersOf(
  declared: TypeDecl | undefined,
  context: EmitContext,
  seen: Set<string> = new Set(),
): MemberRef[] {
  if (declared === undefined) return [];
  const node = declared.node;
  const own = ((node["body"]?.["body"] ?? []) as Node[]).map((member) => ({
    node: member,
    file: declared.file,
  }));
  if (node["type"] !== "TSInterfaceDeclaration" || seen.has(declared.name)) return own;
  seen.add(declared.name);
  const ownKeys = new Set(own.map((member) => nameOf(member.node["key"] as Node | undefined)));
  const inherited: MemberRef[] = [];
  for (const clause of (node["extends"] ?? []) as Node[]) {
    const expression = clause["expression"] as Node | undefined;
    const name = expression === undefined ? undefined : nameOf(expression);
    const base = name === undefined ? undefined : context.index.get(name);
    // 带类型参数的基接口（`interface Base<T>`）：AST 路线替不了实参，展开只会撞上"引用解析失败：T"，
    // 跳过它——与本线对泛型的一贯兜底口径一致（wire 面出现泛型时本来就落 `z.unknown()`）。
    if (((base?.node["typeParameters"]?.["params"] ?? []) as unknown[]).length > 0) continue;
    for (const member of membersOf(base, context, seen)) {
      const key = nameOf(member.node["key"] as Node | undefined);
      if (!ownKeys.has(key)) inherited.push(member);
    }
  }
  return [...inherited, ...own];
}

export function objectOf(members: readonly MemberRef[], context: EmitContext): string {
  const fields: string[] = [];
  const callerFile = context.file;
  for (const { node: member, file } of members) {
    // 继承来的字段要用**基接口那份文件**的导入表渲染（它的类型名不一定在本文件的别名表里）。
    context.file = file ?? callerFile;
    if (member["type"] === "TSIndexSignature") {
      // `[key: string]: T` → `z.record(z.string(), T)`
      const parameter = (member["parameters"] as Node[])[0];
      const key = zodOf(parameter?.["typeAnnotation"]?.["typeAnnotation"] as Node, context);
      const value = zodOf(member["typeAnnotation"]?.["typeAnnotation"] as Node, context);
      return `z.record(${key}, ${value})`;
    }
    if (member["type"] !== "TSPropertySignature") continue;
    const key = nameOf(member["key"] as Node) ?? literalText((member["key"] as Node)["value"]);
    // 继承来的字段来自**另一份声明文件**：它引用的类型名不一定在这条链的别名表里（跨包别名），
    // 解析不了就跳过这一条——而**自身字段**解析不了必须抛，那才是真错。
    const inherited = (file ?? callerFile) !== callerFile;
    let value: string;
    try {
      value = zodOf(member["typeAnnotation"]?.["typeAnnotation"] as Node, context);
    } catch (error) {
      context.file = callerFile;
      if (inherited) continue;
      throw error;
    }
    // 顺序固定：`.readonly()` 先、`.optional()` 后（上游产物就是这么落的）。
    if (member["readonly"] === true) value += ".readonly()";
    if (member["optional"] === true) value += ".optional()";
    fields.push(`  '${key}': ${value},`);
  }
  context.file = callerFile;
  return `z.object({\n${fields.join("\n")}\n})`;
}

const BUILTIN: Record<string, (args: Node[], context: EmitContext) => string> = {
  Promise: (args, context) => zodOf(args[0], context),
  AsyncIterable: (args, context) => zodOf(args[0], context),
  Array: (args, context) => `z.array(${zodOf(args[0], context)})`,
  ReadonlyArray: (args, context) => `z.array(${zodOf(args[0], context)}).readonly()`,
  Record: (args, context) => `z.record(${zodOf(args[0], context)}, ${zodOf(args[1], context)})`,
  // 上游 `standard` 表里只有这几个：`Date` / `Uint8Array` 各有专门投影，其余 standard 一律 fail。
  Date: () => "z.date()",
  Uint8Array: () => "z.instanceof(Uint8Array)",
  // TS 内置工具类型：`Partial` / `Readonly` 直接把对象类型的字段逐个改修饰符（wire 面就是那个形状）。
  Partial: (args, context) => mappedObject(args[0], context, { optional: true }),
  Readonly: (args, context) => mappedObject(args[0], context, { readonly: true }),
  // `Omit<T, K>` 是「去掉几个键」，wire 面上就是少几个字段：按 K 的字面量把成员滤掉。
  // K 不是可静态求值的字面量联合（`keyof T` 之类）时报错——与 `standard` 表之外一律 fail 同一口径。
  Omit: (args, context) => selectedObject(args[0], args[1], context, "omit"),
  // `Pick<T, K>` 是反面：只留 K 点名的键。
  Pick: (args, context) => selectedObject(args[0], args[1], context, "pick"),
};

/**
 * `Omit<T, K>` / `Pick<T, K>`：按 K 点名的键过滤对象类型的成员。
 * @param mode - `omit` 去掉这些键，`pick` 只留这些键。
 */
function selectedObject(
  node: Node | undefined,
  keys: Node | undefined,
  context: EmitContext,
  mode: "omit" | "pick",
): string {
  const literal = objectLiteralOf(node, context);
  if (literal === undefined) return zodOf(node, context);
  const selected = literalKeysOf(keys);
  if (selected === undefined) {
    throw new Error(`${mode === "omit" ? "Omit" : "Pick"} 的键不是可静态求值的字面量联合：${describeNode(keys)}`);
  }
  return objectOf(
    literal
      .filter((member) => {
        const name = propertyNameOf(member);
        if (name === undefined) return mode === "omit";
        return mode === "omit" ? !selected.has(name) : selected.has(name);
      })
      .map((member) => ({ node: member, file: context.file })),
    context,
  );
}

/** 成员键名（`Identifier` 或字符串字面量）。 */
function propertyNameOf(member: Node): string | undefined {
  const key = member["key"] as Node | undefined;
  if (key === undefined) return undefined;
  if (key["type"] === "Identifier") return key["name"] as string;
  const value = key["value"];
  return typeof value === "string" ? value : undefined;
}

/**
 * 把 `'a' | 'b'` 求成键集合。
 * @returns 求不出来（含 `keyof` 之类的非字面量）时 `undefined`。
 */
function literalKeysOf(node: Node | undefined): Set<string> | undefined {
  const out = new Set<string>();
  const visit = (current: Node | undefined): boolean => {
    if (current === undefined) return false;
    if (current["type"] === "TSLiteralType") {
      const literal = current["literal"] as Node | undefined;
      const value = literal?.["value"];
      if (typeof value !== "string") return false;
      out.add(value);
      return true;
    }
    if (current["type"] === "TSUnionType") {
      return (current["types"] as Node[]).every((each) => visit(each));
    }
    return false;
  };
  return visit(node) ? out : undefined;
}

/** 报错里给一眼能看懂的节点描述（不引整个 AST）。 */
function describeNode(node: Node | undefined): string {
  if (node === undefined) return "<missing>";
  const name = nameOf(node);
  return name ?? String(node["type"]);
}

/** 对对象类型的每个字段施加修饰符（`Partial<T>` / `Readonly<T>`）。 */
function mappedObject(
  node: Node | undefined,
  context: EmitContext,
  modifiers: { optional?: boolean; readonly?: boolean },
): string {
  const literal = objectLiteralOf(node, context);
  if (literal === undefined) return zodOf(node, context);
  return objectOf(
    literal.map((member) => ({
      node: {
        ...member,
        ...(modifiers.optional === true && member["optional"] !== true ? { optional: true } : {}),
        ...(modifiers.readonly === true ? { readonly: true } : {}),
      },
      file: context.file,
    })),
    context,
  );
}

/** 拿对象类型的成员（`TSTypeLiteral`，或顺着引用/交叉/索引找到的那个字面量）。 */
function objectLiteralOf(node: Node | undefined, context: EmitContext): Node[] | undefined {
  if (node === undefined) return undefined;
  if (node["type"] === "TSTypeLiteral") return node["members"] as Node[];
  if (node["type"] === "TSTypeReference") {
    const name = nameOf(node["typeName"] as Node);
    const declared = name === undefined ? undefined : context.index.get(name);
    return declared === undefined
      ? undefined
      : objectLiteralOf(declared.node["typeAnnotation"] as Node | undefined, context);
  }
  return undefined;
}

/** 文件路径 → 包名（从 `<…>/packages/<组>/<包>/…` 里取）。 */
function packageOf(file: string): string {
  const parts = file.split("/packages/")[1]?.split("/") ?? [];
  return parts.length >= 2 ? `${String(parts[0])}/${String(parts[1])}` : "";
}

/** 文件 → 别名表的键（去扩展名，`x.d.ts` 与 `x.ts` 归一到同一个）。 */
function relativeKey(file: string): string {
  const marker = "/packages/";
  const tail = file.slice(file.lastIndexOf(marker) + marker.length);
  // 声明树是 `x.d.ts`、源码树是 `x.ts`——`.d.ts` 要整个去掉，别只去 `.ts`。
  return tail.replace(/(\.d)?\.[jt]sx?$/u, "");
}

/** 顺着导入别名 + 包出口表找声明（AST 路线的跨包解析）。 */
function viaAlias(name: string, context: EmitContext): TypeDecl | undefined {
  // 别名表按"仓库相对路径尾段"建键（声明树与源码树是两份拷贝，绝对路径对不上）。
  const key = context.file === undefined ? undefined : relativeKey(context.file);
  const aliases = key === undefined ? undefined : context.aliases?.get(key);
  const alias = aliases?.get(name);
  if (alias === undefined || ("namespace" in alias && alias.namespace === true)) return undefined;
  // 相对导入在建表时就解析成声明了；跨包导入再去出口表查一次。
  const resolved =
    "declared" in alias ? alias.declared : context.exports?.get(alias.pkg)?.get(alias.name);
  if (resolved === undefined || !isTypeDeclaration(resolved.node)) return undefined;
  return {
    name,
    owner:
      "declared" in alias
        ? alias.declared.file.includes("/packages/")
          ? packageOf(alias.declared.file)
          : ""
        : alias.pkg,
    node: resolved.node,
    file: resolved.file,
    text: resolved.text,
  };
}

/** 命名空间导入（`import type * as Host from '@fixture/host'`）下的限定名。 */
function viaNamespace(
  namespace: string,
  exported: string,
  context: EmitContext,
): TypeDecl | undefined {
  const key = context.file === undefined ? undefined : relativeKey(context.file);
  const alias = key === undefined ? undefined : context.aliases?.get(key)?.get(namespace);
  if (alias === undefined || "declared" in alias) return undefined;
  const declared = context.exports?.get(alias.pkg)?.get(exported);
  if (declared === undefined || !isTypeDeclaration(declared.node)) return undefined;
  return {
    name: exported,
    owner: alias.pkg,
    node: declared.node,
    file: declared.file,
    text: declared.text,
  };
}

function referenceOf(node: Node, context: EmitContext): string {
  const typeName = node["typeName"] as Node;
  // `Host.Agent`：左半是命名空间别名，右半是目标包里的导出名。
  if (typeName["type"] === "TSQualifiedName") {
    const namespace = nameOf(typeName["left"] as Node);
    const exported = nameOf(typeName["right"] as Node);
    const declared =
      namespace === undefined || exported === undefined
        ? undefined
        : viaNamespace(namespace, exported, context);
    if (declared !== undefined) {
      context.referenced.add(exported ?? "");
      return zodOf(
        declared.node["body"] === undefined
          ? declared.node
          : { type: "TSTypeLiteral", members: membersOf(declared, context) as unknown },
        context,
      );
    }
  }
  const name = nameOf(typeName);
  const args = typeArgumentsOf(node);
  if (name === undefined) return "z.unknown()";
  // 泛型形参：用引用处传进来的实参代入（`Box<string>` 里的 `T` 就是 `string`）。
  const substituted = context.typeArguments.get(name);
  if (substituted !== undefined) {
    // 实参可能就是形参自己（`type F<T> = T` 被引用成 `F<T>`），代入前先看名字，别原地打转。
    const substitutedName = nameOf((substituted["typeName"] ?? substituted) as Node);
    if (substitutedName === name) return "z.unknown()";
    // 形参之间可能互相代入（`F<T> = G<T>`、`G<U> = F<U>`），代入也过一遍展开栈。
    const guard = `substitute|${name}`;
    if (context.stack.has(guard)) return "z.unknown()";
    context.stack.add(guard);
    try {
      return zodOf(substituted, context);
    } finally {
      context.stack.delete(guard);
    }
  }
  const builtin = BUILTIN[name];
  if (builtin !== undefined) return builtin(args, context);
  context.referenced.add(name);
  // 跨包引用：先看当前文件的导入别名（`HostAgent` / `HostDefault` / `Host.Agent` 里的 `Host`），
  // 顺着包的出口表指回真实声明；找不到再退回按名字查索引。
  const throughAlias = viaAlias(name, context);
  const declared = throughAlias ?? context.index.get(name);
  // 与上游同规则：解析不了就**报错**，不静默降级（上游 `standard` 表之外的引用一律 fail）。
  if (declared === undefined) {
    throw new Error(`引用解析失败：${name}（没有声明，或不在导入别名 / 包出口表里）`);
  }
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
              {
                type: "TSTypeLiteral",
                members: membersOf(declaredSelf, context),
              },
              context,
            );
      context.named.set(symbol, definition);
    }
    return `z.lazy(() => ${symbol}$schema())`;
  }
  context.stack.add(name);
  // 展开时按**声明所在文件**查别名：`context.file` 是服务文件，而它的导入表在另一个文件里
  // （`src/index.ts` 的类型，导入写在 `src/types.ts`）。
  const callerFile = context.file;
  const callerArguments = context.typeArguments;
  context.file = declared.file;
  // 形参 → 实参：实参来自引用处；没给实参就用形参自己的默认值。
  const parameters = (declared.node["typeParameters"]?.["params"] ?? []) as Node[];
  if (parameters.length > 0) {
    const mapping = new Map(callerArguments);
    parameters.forEach((parameter, position) => {
      const parameterName = nameOf((parameter["name"] ?? parameter) as Node);
      const argument =
        args[position] ?? (parameter["default"] as Node | null | undefined) ?? undefined;
      if (parameterName !== undefined && argument !== undefined && argument !== null) {
        mapping.set(parameterName, argument);
      }
    });
    context.typeArguments = mapping;
  }
  let inner: string;
  try {
    inner =
      declared.node["type"] === "TSTypeAliasDeclaration"
        ? zodOf(declared.node["typeAnnotation"] as Node, context)
        : declared.node["type"] === "TSEnumDeclaration"
          ? enumOf(declared.node)
          : objectOf(membersOf(declared, context), context);
  } finally {
    context.file = callerFile;
    context.typeArguments = callerArguments;
    context.stack.delete(name);
  }
  return inner;
}

export function newContext(index: SchemaIndex, extra: Partial<EmitContext> = {}): EmitContext {
  return {
    index,
    stack: new Set(),
    referenced: new Set(),
    named: new Map(),
    file: undefined,
    typeArguments: new Map(),
    ...extra,
  };
}

export type { EmitContext as SchemaEmitContext };
