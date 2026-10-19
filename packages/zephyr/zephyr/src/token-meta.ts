import type { Context } from "@deepseek-ai/cordis";
import type { Newable, Token } from "./injection.ts";

const enum NameState {
  DELIM,
  UPPER,
  LOWER,
}

export function hyphenate(source: string): string {
  const output: string[] = [];
  let state = NameState.DELIM;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code >= 65 && code <= 90) {
      if (state === NameState.UPPER) {
        const next = source.charCodeAt(index + 1);
        if (next >= 97 && next <= 122) output.push("-");
      } else if (state !== NameState.DELIM) {
        output.push("-");
      }
      output.push(String.fromCharCode(code + 32));
      state = NameState.UPPER;
      continue;
    }
    if (code >= 97 && code <= 122) {
      output.push(String.fromCharCode(code));
      state = NameState.LOWER;
      continue;
    }
    if (code === 45 || code === 95) {
      if (state !== NameState.DELIM) output.push("-");
      state = NameState.DELIM;
      continue;
    }
    output.push(String.fromCharCode(code));
  }
  return output.join("");
}

export const enum FiberStateCompat {
  PENDING = 0,
  LOADING = 1,
  ACTIVE = 2,
  FAILED = 3,
}

export interface TokenMeta {
  token: Token;
  name: string;
  impl: Newable;

  providesService: boolean;

  /** 上游 Cordis 服务类：适配令牌（`fromCordisService`）靠它在行 ctx 的服务表里按实例类型找服务。 */
  serviceClass?: Function;

  /** 非 Service 的 Context 值（如 launchEnvironment）的解析器。 */
  serviceResolver?: (ctx: Context) => unknown;

  /** 定义该类的源文件：构建期据此找到它所属的 package.json（行名不手写）。 */
  file?: string;

  /** 同一实例同时提供的令牌（中间层用它把适配类暴露成能力令牌）。 */
  aliases?: readonly Token[];

  /** 值型令牌（`InjectionToken`）：`useValue` 就是服务本身，不能 `new` 它。 */
  isValue?: boolean;
}

// 令牌元数据直接挂在类上（`@Injectable()` 写、装配期读）：没有注册表，也没有模块级/全局状态。
export const kInjectableMeta = Symbol.for("morlay.zephyr.injectable");

function metaOf(token: Function): TokenMeta | undefined {
  return (token as { [kInjectableMeta]?: TokenMeta })[kInjectableMeta];
}

// 装饰器调用点的源文件：跳过 zephyr 自身（与 codegen）的帧，第一个外部文件就是类的定义处。
const ZEPHYR_FRAME = /[\\/](?:packages[\\/]zephyr[\\/]zephyr|devpackages[\\/]zephyr-codegen)[\\/]/u;
// 依赖帧（pnpm 展开后的目录不一定带 `node_modules`；oxc/vitest 的装饰器 helper 也在这里）不是定义处。
const DEPENDENCY_FRAME = /node_modules|[\\/]\.pnpm[\\/]|@oxc-project\+/u;

export function definitionFileOf(): string | undefined {
  const stack = new Error().stack;
  if (stack === undefined) return undefined;
  for (const line of stack.split("\n").slice(1)) {
    const match = /(?:\(|at )([^()]+\.(?:ts|tsx|mts|cts|js|mjs|cjs)):\d+:\d+/u.exec(line);
    const file = match?.[1];
    if (file === undefined || DEPENDENCY_FRAME.test(file) || ZEPHYR_FRAME.test(file)) continue;
    return file;
  }
  return undefined;
}

// 适配类标记挂在类上（与 `kInjectableMeta` 同一口径），模块不持有状态。
// **用普通静态属性而不是 defineProperty + 沿链循环**：静态属性天然被子类继承，
// `isAdapted()` 因此是一次属性读（子类 `extends fromCordis(...)` 就带上了）。
const kAdaptedClass = Symbol.for("morlay.zephyr.adapted-class");

export function markAdapted(cls: Function): void {
  (cls as { [kAdaptedClass]?: boolean })[kAdaptedClass] = true;
}

export function isAdapted(cls: Function): boolean {
  return (cls as { [kAdaptedClass]?: boolean })[kAdaptedClass] === true;
}

export function getTokenName(token: Function): string {
  if (typeof token !== "function") {
    throw new TypeError(`expected a token class, received ${typeof token}`);
  }
  return metaOf(token)?.name ?? hyphenate(token.name);
}

export function getTokenMeta(token: Function): TokenMeta {
  const meta = metaOf(token);
  if (!meta) throw new Error(`token "${token.name}" is not registered, use @Injectable()`);
  return meta;
}

export function tryGetTokenMeta(token: Function): TokenMeta | undefined {
  return metaOf(token);
}

export function resolveToken(cls: Function): Token | undefined {
  const declared = (cls as { token?: Token }).token;
  if (declared !== undefined) return declared;

  for (
    let current = Object.getPrototypeOf(cls);
    typeof current === "function" && current !== Function.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    const meta = metaOf(current);
    if (meta !== undefined) return meta.token;
  }
  return undefined;
}

export class InjectPlaceholder {
  constructor(
    readonly token: Token,

    readonly optional = false,

    readonly multi = false,
  ) {}
}

export function createInjectPlaceholder(token: Token, optional = false, multi = false): any {
  // 可被 `inject` 的只有 `@Injectable()` 标记过的契约：上游内部服务名、没标记的类都不是注入目标。
  if (tryGetTokenMeta(token) === undefined) {
    const name = (token as { name?: string }).name ?? String(token);
    throw new Error(`inject() 的目标必须是 @Injectable() 契约：${name}`);
  }
  const placeholder = new InjectPlaceholder(token, optional, multi);
  return new Proxy(placeholder, {
    // 占位是 Proxy：显式给出原型，`construct()` 的 `instanceof` 判定才可靠。
    getPrototypeOf: () => InjectPlaceholder.prototype,
    get(target, property, receiver) {
      if (
        property === "token" ||
        property === "optional" ||
        property === "multi" ||
        property === "constructor" ||
        property === Symbol.toStringTag
      ) {
        return Reflect.get(target, property, receiver);
      }
      throw new Error(
        `dependency "${getTokenName(token)}" is not ready yet; ` +
          "access injected services in onInit() or later",
      );
    },
  });
}