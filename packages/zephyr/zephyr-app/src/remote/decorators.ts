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
  };
}

/** 在实现类上定义方法转发：`this.remote[group][method](...args)`。 */
function defineForwarder(ctor: new () => object, method: string): void {
  const proto = (ctor as { prototype: Record<string, unknown> }).prototype;
  if (Object.getOwnPropertyDescriptor(proto, method)?.value !== undefined) return;
  Object.defineProperty(proto, method, {
    value: function forwarded(
      this: { remote?: { upstream?: Record<string, Record<string, (...args: never[]) => unknown>> } },
      ...args: never[]
    ): unknown {
      const group = remoteGroupNameOf(this.constructor);
      const face = group === undefined ? undefined : this.remote?.upstream?.[group];
      const fn = face?.[method];
      // 宿主没挂这一组（离线 / 精简装配）时返回 `undefined`：调用方按空态处理。
      if (fn === undefined) return undefined;
      return fn.apply(face, args);
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
