// 参数声明：**命令手写，声明即自动注册为 flags**。
//
// 一份声明同时供三处使用：argv 解析、`--help` 生成、命令实现的类型。所以这里没有第二份 schema，
// 也没有「注册到解析器」这一步——命令类把 `params` 放在字段上，内核拿它干活。
import { usageError } from "./errors.ts";

/** 参数种类。 */
export type ParamKind = "string" | "number" | "boolean" | "enum" | "position";

/** 所有参数共有的部分。 */
interface ParamBase {
  /** `--help` 里的一行说明。 */
  readonly description: string;
}

/** 字符串参数（`--name <值>`）。 */
export interface StringParam extends ParamBase {
  readonly kind: "string";
  readonly default?: string;
}

/** 数字参数（`--name <n>`）。 */
export interface NumberParam extends ParamBase {
  readonly kind: "number";
  readonly default?: number;
}

/** 布尔参数：`--name` 为真，`--no-name` 为假。 */
export interface BooleanParam extends ParamBase {
  readonly kind: "boolean";
  readonly default?: boolean;
}

/**
 * 枚举参数（`--name <a|b>`）；`allowPath` 时额外接受绝对路径。
 *
 * `--data-dir` 就是这一种：`workspace|xdg|<绝对路径>`。把它做成「枚举 + 路径」而不是
 * 「随便一个字符串」，是为了让 `--help` 与错误信息能说出合法的取值。
 */
export interface EnumParam extends ParamBase {
  readonly kind: "enum";
  readonly values: readonly string[];
  readonly allowPath?: boolean;
  readonly default?: string;
}

/** 位置参数（按声明顺序消费不以 `-` 开头的实参）。 */
export interface PositionParam extends ParamBase {
  readonly kind: "position";
  readonly default?: string;
}

/** 一个参数的声明。 */
export type ParamSpec = StringParam | NumberParam | BooleanParam | EnumParam | PositionParam;

/** 一份参数声明表；键就是取值时的键（flag 名由它派生）。 */
export type ParamSpecs = Readonly<Record<string, ParamSpec>>;

/** 解析结果。 */
export interface ParsedParams {
  /** 各参数的取值；未给出且无默认值时为 `undefined`。 */
  readonly values: Readonly<Record<string, string | number | boolean | undefined>>;
  /** 是否请求了 `--help`。 */
  readonly help: boolean;
}

/** 参数的取值类型。 */
export type ParamValue = string | number | boolean | undefined;

/**
 * 键 → flag 名：`dataDir` → `data-dir`。
 * @param key - 声明里的键。
 * @returns flag 名（不含前导 `--`）。
 */
export function flagOf(key: string): string {
  return key.replace(/[A-Z]/gu, (char) => `-${char.toLowerCase()}`);
}

/** 位置参数声明（按对象里的顺序）。 */
function positionsOf(specs: ParamSpecs): readonly [string, PositionParam][] {
  return Object.entries(specs).filter(
    (entry): entry is [string, PositionParam] => entry[1].kind === "position",
  );
}

/**
 * 解析 argv。
 *
 * 支持的写法：`--flag`、`--flag=值`、`--flag 值`、`--no-flag`、位置参数、`--help`/`-h`。
 * 未知 flag 与非法取值一律算**用法错误**（退出码 2），并在消息里指出是哪个参数。
 * @param specs - 参数声明。
 * @param argv - 命令之后的实参。
 * @returns 取值与 help 标记。
 */
export function parseParams(specs: ParamSpecs, argv: readonly string[]): ParsedParams {
  const values: Record<string, ParamValue> = {};
  for (const [key, spec] of Object.entries(specs)) {
    if (spec.kind === "boolean") values[key] = spec.default ?? false;
    else if (spec.kind !== "position") values[key] = spec.default;
  }
  const positions = positionsOf(specs);
  const rest: string[] = [];
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") {
      rest.push(arg);
      continue;
    }
    const trimmed = arg.replace(/^--/u, "");
    const [rawName, inline] = splitOnce(trimmed, "=");
    if (rawName.startsWith("no-")) {
      const negated = nameOf(specs, rawName.slice(3));
      if (negated === undefined || negated.spec.kind !== "boolean") {
        throw usageError(`未知参数 ${arg}`);
      }
      if (inline !== undefined) throw usageError(`${arg} 不该带值`);
      values[negated.key] = false;
      continue;
    }
    const found = nameOf(specs, rawName);
    if (found === undefined) throw usageError(`未知参数 ${arg}`);
    const { key, spec } = found;
    if (spec.kind === "boolean") {
      if (inline !== undefined) throw usageError(`${arg} 不该带值`);
      values[key] = true;
      continue;
    }
    const consumed = inline ?? argv[index + 1];
    if (inline === undefined) index += 1;
    if (consumed === undefined) throw usageError(`${arg} 缺一个值`);
    values[key] = coerce(arg, spec, consumed);
  }

  positions.forEach(([key, spec], order) => {
    const given = rest[order];
    if (given === undefined) {
      if (spec.default === undefined) return;
      values[key] = spec.default;
      return;
    }
    values[key] = given;
  });
  // 多出来的位置参数不算错：插件命令可能想自己看（例如把剩下的都当路径）。
  return { values, help };
}

/**
 * 按声明把一个字符串值转成目标类型，越界即用法错误。
 * @param flag - 原始 flag 文本（错误信息用）。
 * @param spec - 参数声明。
 * @param raw - 原始字符串。
 * @returns 转换后的值。
 */
function coerce(flag: string, spec: ParamSpec, raw: string): string | number {
  switch (spec.kind) {
    case "number": {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) throw usageError(`${flag} 需要一个数字，收到 ${raw}`);
      return parsed;
    }
    case "enum": {
      if (spec.values.includes(raw)) return raw;
      if (spec.allowPath === true && (raw.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(raw))) {
        return raw;
      }
      throw usageError(
        `${flag} 只接受 ${[...spec.values, spec.allowPath === true ? "<绝对路径>" : ""].filter(Boolean).join(" | ")}，收到 ${raw}`,
      );
    }
    default:
      return raw;
  }
}

/**
 * 按 flag 名找声明。
 * @param specs - 参数声明。
 * @param flag - 去掉前导 `--` 的名字。
 * @returns 键与声明，或 `undefined`。
 */
function nameOf(
  specs: ParamSpecs,
  flag: string,
): { readonly key: string; readonly spec: ParamSpec } | undefined {
  for (const [key, spec] of Object.entries(specs)) {
    if (spec.kind === "position") continue;
    if (flagOf(key) === flag) return { key, spec };
  }
  return undefined;
}

/**
 * 按第一个分隔符切两半。
 * @param text - 原文。
 * @param separator - 分隔符。
 * @returns 左半与右半（没有分隔符时右半为 `undefined`）。
 */
function splitOnce(text: string, separator: string): [string, string | undefined] {
  const at = text.indexOf(separator);
  if (at < 0) return [text, undefined];
  return [text.slice(0, at), text.slice(at + separator.length)];
}

/**
 * 生成一行 usage。
 * @param path - 命令路径（首段由 bin 名补）。
 * @param specs - 参数声明。
 * @returns `zephyr <命令> [options] [<位置参数>]` 形态的一行。
 */
export function usageOf(path: readonly string[], specs: ParamSpecs): string {
  const command = ["zephyr", ...path].join(" ");
  const hasOptions = Object.values(specs).some((spec) => spec.kind !== "position");
  const positions = positionsOf(specs).map(
    ([key]) => `[${flagOf(key) === key ? key : flagOf(key)}]`,
  );
  const tail = [hasOptions ? "[options]" : "", ...positions].filter(Boolean).join(" ");
  return tail === "" ? command : `${command} ${tail}`;
}

/**
 * 生成 `--help` 正文。
 * @param input - 命令路径、说明与参数声明。
 * @returns 多行文本。
 */
export function helpOf(input: {
  readonly path: readonly string[];
  readonly description: string;
  readonly params: ParamSpecs;
}): string {
  const lines = [`用法: ${usageOf(input.path, input.params)}`, "", input.description];
  const options = Object.entries(input.params).filter(([, spec]) => spec.kind !== "position");
  if (options.length > 0) {
    lines.push("", "选项:");
    for (const [key, spec] of options) {
      lines.push(`  ${flagUsage(key, spec)}`);
    }
  }
  const positions = positionsOf(input.params);
  if (positions.length > 0) {
    lines.push("", "参数:");
    for (const [key, spec] of positions) {
      lines.push(
        `  ${key}${spec.default === undefined ? "" : ` (默认: ${spec.default})`}  ${spec.description}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * 一个选项在 help 里的样子（含占位符与默认值）。
 * @param key - 声明键。
 * @param spec - 参数声明。
 * @returns 单行文本。
 */
function flagUsage(key: string, spec: ParamSpec): string {
  const flag = flagOf(key);
  const placeholder = (() => {
    switch (spec.kind) {
      case "enum":
        return ` <${[...spec.values, spec.allowPath === true ? "绝对路径" : ""].filter(Boolean).join("|")}>`;
      case "boolean":
        return "";
      default:
        return spec.kind === "position" ? "" : ` <${spec.kind === "number" ? "n" : "值"}>`;
    }
  })();
  const negation = spec.kind === "boolean" ? ` / --no-${flag}` : "";
  const fallback =
    "default" in spec && spec.default !== undefined ? `（默认: ${String(spec.default)}）` : "";
  return `--${flag}${placeholder}${negation}  ${spec.description}${fallback}`;
}
