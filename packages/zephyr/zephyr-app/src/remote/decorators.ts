// remote 的两层语法糖（与上游 `remote.<group>.<method>` 的形态一一对应）：
//
//   @RemoteGroup({ name: "session" })       abstract class SessionRemote {     // 组（契约）
//     @Remote() abstract list(): …;                                          // 组里的方法
//   }
//   @RemoteGroup()                          class SessionRemoteDefault extends SessionRemote {  // 组（实现）
//     @Remote() list() { … }                                                 // 方法实现
//   }
//
// 契约写 `name`（组名 / 方法名），实现不写；组与方法的**名字都只在契约上**出现。
import { Injectable } from "@morlay/zephyr";

const kRemoteGroup = Symbol.for("zephyr.remote-group");
const kRemoteMethod = Symbol.for("zephyr.remote-method");
/** `mode: "stream"` 的方法名（注册时走 `registerStream`）。 */
const kRemoteStreamMethod = Symbol.for("zephyr.remote-stream-method");
/** `parameters` 声明：方法名 → wire 参数名列表。 */
const kRemoteMethodParameters = Symbol.for("zephyr.remote-method-parameters");

/** `@RemoteGroup` 的选项。 */
export interface RemoteGroupOptions {
  /** 上游实例上的组名（`remote.<name>`）。省略取类名。 */
  readonly name?: string;
}

/** `@Remote`（方法）的选项。 */
export interface RemoteMethodOptions {
  /** 组内的方法名。省略取方法名。 */
  readonly name?: string;
  /**
   * `"stream"` 表示这个方法逐帧产出（`workspace/follow`、`job/list` 这类）。
   *
   * 注册时走 `handlers.registerStream`（宿主逐帧写 `item`），unary 走 `handlers.register`。
   * 客户端形态的转发对两者同形：`remote.upstream.<group>.<method>(…args)`。
   */
  readonly mode?: "stream";

  /**
   * wire 上的**命名参数**名（位置对应契约方法的形参）。
   *
   * 省略时统一叫 `request`——那是宿主侧 `registerRemoteGroup` 的 `requestOf(args)` 读的键。
   * 只有「上游按位置传一个标量」的方法才需要另写（`commands/list` 上游是
   * `remote.commands.list(sessionId)`，wire 上就该是 `{ sessionId }` 而不是 `{ request: sessionId }`）。
   */
  readonly parameters?: readonly string[];
}

/** 组/方法的元数据。 */
interface GroupMeta {
  readonly options: RemoteGroupOptions;
}

/** 沿原型链收集 `@RemoteGroup` 元数据（实现类 → 契约类）。 */
function groupMetasOf(target: unknown): readonly { meta: GroupMeta; cls: unknown }[] {
  const found: { meta: GroupMeta; cls: unknown }[] = [];
  let current = target as { [kRemoteGroup]?: GroupMeta; prototype?: unknown } | null | undefined;
  while (typeof current === "function") {
    const meta = current[kRemoteGroup];
    if (meta !== undefined) found.push({ meta, cls: current });
    current = Object.getPrototypeOf(current) as typeof current;
  }
  return found;
}

/**
 * 组名（契约写、实现继承）。
 * @param cls - 组契约或实现类。
 * @returns 上游实例上的组名。
 */
export function remoteGroupNameOf(cls: unknown): string | undefined {
  const metas = groupMetasOf(cls);
  // 名字声明在**契约**上；实现类自己标 `@RemoteGroup()`（不写名字），所以沿链取第一个带 name 的。
  const named = metas.find(({ meta }) => meta.options.name !== undefined);
  if (named !== undefined) return named.meta.options.name;
  return (metas[metas.length - 1]?.cls as { name?: string } | undefined)?.name;
}

/**
 * 一组组内方法的声明（契约上每个 `@Remote()` 方法一条）。
 * @param cls - 组契约类。
 * @returns 方法名列表。
 */
export function remoteMethodsOf(cls: unknown): readonly string[] {
  // 沿原型链收集：名字声明在**契约**上，实现类是它的子类，注册时要按契约上的声明来。
  const collected: string[] = [];
  type WithMethods = { [kRemoteMethod]?: readonly string[] };
  let current = cls as (WithMethods & { prototype?: unknown }) | null | undefined;
  while (typeof current === "function") {
    const declared = (current as WithMethods)[kRemoteMethod];
    if (declared !== undefined) collected.push(...declared);
    current = Object.getPrototypeOf(current) as typeof current;
  }
  return [...new Set(collected)];
}

/**
 * 一组**流式**方法（`@RemoteMethod({ mode: "stream" })`）的名字。
 * @param cls - 组契约类。
 * @returns 流式方法名列表。
 */
export function remoteStreamMethodsOf(cls: unknown): readonly string[] {
  const collected: string[] = [];
  type WithStreams = { [kRemoteStreamMethod]?: readonly string[] };
  let current = cls as (WithStreams & { prototype?: unknown }) | null | undefined;
  while (typeof current === "function") {
    const declared = (current as WithStreams)[kRemoteStreamMethod];
    if (declared !== undefined) collected.push(...declared);
    current = Object.getPrototypeOf(current) as typeof current;
  }
  return [...new Set(collected)];
}

/** `$mount` 吃的一份绑定：`{ descriptors }`（与上游 `TYPERT_REMOTE` 同形）。 */
export interface RemoteDescriptor {
  /** 组名（`remote.<namespace>`）。 */
  readonly namespace: string;

  /** 组内方法名。 */
  readonly method: string;

  /** `"stream"` 表示逐帧产出。 */
  readonly mode?: "stream";

  /** wire 的命名参数声明：`faceOf` 按它把位置实参映射成命名参数。 */
  readonly parameters: readonly { readonly name: string }[];
}

/**
 * 把一份 `@RemoteGroup` 契约编译成 `$mount` 要的 descriptors。
 *
 * 我们自己声明的组（`commands` 这类）不在上游 `TYPERT_REMOTE` 里，客户端因此没有
 * `remote.<namespace>` 那一面；这份产出就是补上它的那一环，与宿主侧的 `registerRemoteGroup`
 * 成对（同一份声明，两个方向）。
 *
 * 参数名统一叫 `request`：宿主侧 `registerRemoteGroup` 的 `requestOf(args)` 读的就是 `args.request`，
 * 两边是同一个约定。流式方法的最后一个形参是取消信号，不进 wire 参数。
 * @param cls - 组契约类。
 * @returns `$mount` 的入参。
 */
export function remoteDescriptorsOf(cls: unknown): { descriptors: readonly RemoteDescriptor[] } {
  const namespace = remoteGroupNameOf(cls);
  if (namespace === undefined) {
    throw new Error(`${String((cls as { name?: string }).name)} 没有 @RemoteGroup：无法编译 remote descriptors`);
  }
  const streams = new Set(remoteStreamMethodsOf(cls));
  const declaredParameters = remoteMethodParametersOf(cls);
  const prototype = (cls as { prototype?: Record<string, unknown> }).prototype ?? {};
  const descriptors = remoteMethodsOf(cls).map((method): RemoteDescriptor => {
    const streamed = streams.has(method);
    const handler = prototype[method];
    // 参数名：契约上显式声明优先；否则按形参个数全叫 `request`（宿主 `requestOf(args)` 的约定）。
    const explicit = declaredParameters[method];
    const arity = typeof handler === "function" ? Math.max(handler.length - (streamed ? 1 : 0), 1) : 1;
    const names = explicit ?? Array.from({ length: arity }, () => "request");
    return {
      namespace,
      method,
      ...(streamed ? { mode: "stream" as const } : {}),
      parameters: names.map((name) => ({ name })),
    };
  });
  return { descriptors };
}

/** 组装饰器：契约只标元数据；实现把上游那一组面暴露成自己的方法。 */
export function RemoteGroup(options: RemoteGroupOptions = {}): ClassDecorator {
  return (target) => {
    const ctor = target as unknown as new () => object;
    Object.defineProperty(ctor, kRemoteGroup, {
      value: { options } satisfies GroupMeta,
      configurable: true,
    });
    Injectable()(ctor);
    // 组里声明过的每个方法：本类没实现时生成转发（调用时走上游那一组面
    // `remote.<group>.<method>(...)`）。契约类因此可以直接当客户端用。
    for (const name of remoteMethodsOf(ctor)) {
      defineForwarder(ctor, name);
    }
  };
}

/**
 * 方法装饰器：标记「这个方法是 remote 组里的一个方法」。
 *
 * 契约上它只是登记名字；实现上由 `@RemoteGroup` 统一生成转发（不用手写）。
 * @param options - `name`：上游那一组里叫什么（省略取方法名）。
 * @returns 方法装饰器。
 */
export function Remote(options: RemoteMethodOptions = {}): MethodDecorator {
  return (target, propertyKey) => {
    const ctor = target.constructor as unknown as {
      [kRemoteMethod]?: string[];
      [kRemoteStreamMethod]?: string[];
      [kRemoteMethodParameters]?: Readonly<Record<string, readonly string[]>>;
    };
    const name = options.name ?? String(propertyKey);
    Object.defineProperty(ctor, kRemoteMethod, {
      value: [...(ctor[kRemoteMethod] ?? []), name],
      configurable: true,
    });
    if (options.mode === "stream") {
      Object.defineProperty(ctor, kRemoteStreamMethod, {
        value: [...(ctor[kRemoteStreamMethod] ?? []), name],
        configurable: true,
      });
    }
    if (options.parameters !== undefined) {
      Object.defineProperty(ctor, kRemoteMethodParameters, {
        value: { ...ctor[kRemoteMethodParameters], [name]: options.parameters },
        configurable: true,
      });
    }
  };
}

/**
 * 一组方法各自的 wire 参数名（`@RemoteMethod({ parameters: [...] })` 声明的那些）。
 * @param cls - 组契约类。
 * @returns 方法名 → 参数名列表。
 */
export function remoteMethodParametersOf(cls: unknown): Readonly<Record<string, readonly string[]>> {
  const collected: Record<string, readonly string[]> = {};
  type WithParameters = { [kRemoteMethodParameters]?: Readonly<Record<string, readonly string[]>> };
  let current = cls as (WithParameters & { prototype?: unknown }) | null | undefined;
  while (typeof current === "function") {
    Object.assign(collected, (current as WithParameters)[kRemoteMethodParameters] ?? {});
    current = Object.getPrototypeOf(current) as typeof current;
  }
  return collected;
}

/**
 * 在实现类上定义方法转发：走 `remote.invoke('<group>/<method>', args)`。
 *
 * 参数形状与宿主侧 `registerRemoteGroup` 的 `requestOf(args)` 对称——契约方法的第一个形参就是
 * 请求（`{ request }`），无参方法给空对象。
 *
 * **不走 `remote.<group>`**：那个面只对 `$mount` 过的上游 namespace 存在，我们自己声明的组
 * （`commands`）不在上游 `TYPERT_REMOTE` 里，读到的永远是 `undefined`。
 */
function defineForwarder(ctor: new () => object, method: string): void {
  const proto = (ctor as { prototype: Record<string, unknown> }).prototype;
  if (Object.getOwnPropertyDescriptor(proto, method)?.value !== undefined) return;
  Object.defineProperty(proto, method, {
    value: function forwarded(
      this: {
        remote?: { invoke?: (endpoint: string, args: Readonly<Record<string, unknown>>) => Promise<unknown> };
      },
      ...args: never[]
    ): unknown {
      const group = remoteGroupNameOf(this.constructor);
      const invoke = this.remote?.invoke;
      // 宿主没接这一层（离线 / 精简装配）时返回 `undefined`：调用方按空态处理。
      if (group === undefined || invoke === undefined) return undefined;
      const wireArgs = args.length === 0 ? {} : { request: args[0] };
      return invoke.call(this.remote, `${group}/${method}`, wireArgs);
    },
    configurable: true,
    writable: true,
  });
}

/**
 * 客户端形态：一个「只消费、不实现」的契约实例。
 *
 * ```ts
 * @RemoteClient()
 * export class CommandEndpointClient extends CommandEndpoint {}
 * ```
 *
 * 它做两件事：给类挂上 `@RemoteGroup()`（组名继承契约、方法生成转发），再把 `Remote` 登记成
 * 构造期依赖——转发函数（运行期执行）要读 `this.remote.upstream[group][method]`，而 `inject()` 是
 * 「构造期登记」的，所以这个字段必须在实例构造时存在，不能等到方法调用时再取。
 *
 * 实现上返回一个包了一层的子类（legacy 装饰器允许替换构造函数）：外层只多一个 `remote` 字段，
 * 原型链仍指向契约，`remoteGroupNameOf` / `remoteMethodsOf` 照常沿链找到组名与方法名。
 * @returns 类装饰器。
 */

/**
 * 客户端形态：一个「只消费、不实现」的契约实例。
 *
 * ```ts
 * @RemoteClient()
 * export class CommandEndpointClient extends CommandEndpoint {}
 * ```
 *
 * 与 `@RemoteGroup()` 的分工：那个标在**服务端**（契约与宿主实现），负责组名与 wire 注册；
 * 这个标在**消费端**，只做两件事——把类注册成 provider（`Injectable`）、给契约里声明的每个方法生成
 * 转发（读 `this.remote.upstream[group][method]`，`remote` 来自契约继承的 `RemoteClientBase`）。
 * 组名从契约上继承，这里不写。
 * @returns 类装饰器。
 */
export function RemoteClient(): ClassDecorator {
  return (target) => {
    const ctor = target as unknown as new () => object;
    Injectable()(ctor);
    for (const name of remoteMethodsOf(ctor)) {
      defineForwarder(ctor, name);
    }
  };
}
