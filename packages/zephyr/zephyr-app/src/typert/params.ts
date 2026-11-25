/**
 * **宿主面 → wire 面**的两个形参级工具。框架**不认识任何业务类型**（`Agent` / `SessionId` / `AbortSignal`
 * 都由调用方给），这里只说两件事：从形参表里**去掉**某类形参，或把某类形参**换成**另一种类型。
 *
 * 为什么需要：wire 上的签名不是宿主方法的原文——网关在两侧各做一次投影。出处：
 * - `AbortSignal` 不是 wire 参数，它走 `cancellation`
 *   （`vendor/deepseek-harness/packages/interaction/commands/lib/typert.host.ts:93`
 *   `cancellation: { parameter: 'signal' }`）→ {@link DropParam}；
 * - lookup 参数按 id 传：宿主收 `Agent`（同包 `src/index.ts:361`），wire 上是 `agentId: SessionId`
 *   （同包 `lib/typert.remote-client.ts:150`；descriptor 侧 `source: 'lookup', lookup: 'agent'`，
 *   见 `lib/typert.host.ts:60-71`）→ {@link MapParam}。
 *
 * **为什么不用 `implements` 校验投影结果**：`implements` 与单向可赋值是同一个关系，而形参在参数位置是
 * **逆变**的——放宽永远合法。实测：`interface Face { execute(atts: readonly A[]): void }` 配
 * `class Widened implements Face { execute(_atts: readonly unknown[]): void {} }` **不报错**。
 * 所以「契约的形参放宽了」这件事只能靠**双向**判据抓（见 `AssertWireFace`），这三个工具只负责投影，
 * 不负责比较。
 *
 * **不支持方法重载**：一个键有多个签名时，`infer Args` 只取最后一个签名，其余被静默丢弃。上游的
 * `@Remote` 方法都是一键一签名（生成器按 `@Remote` 收集，见 `devpackages/typert-generator/src/index.ts`），
 * 所以现状用不到；将来真遇到重载，应当拆成两个方法名，而不是让这个工具去猜。
 */

/** 一个形参位是不是「要处理的类型」：`P` 本身，或 `P | undefined`（可选形参在元组里带 `undefined`）。 */
type Matches<Argument, P> = [Argument] extends [P]
  ? true
  : [Argument] extends [P | undefined]
    ? true
    : false;

/**
 * 从形参元组里去掉匹配 `P` 的位。
 *
 * **只处理「全是必填位的普通元组」**，而且是**从尾部**去掉匹配项：cancellation 参数永远是最后一个形参
 * （`lib/typert.host.ts:93` 的 `cancellation.parameter`）。带可选位或 rest 的元组**原样返回**——
 * `[...infer Init, infer Last]` 解构不了可选位，硬拆会把 `x?: T` 变成必填或整段丢掉（试过：会静默丢位）。
 * 宁可不动，也不猜。
 */
type DropFrom<Args extends readonly unknown[], P> = Args extends readonly [
  ...infer Init extends readonly unknown[],
  infer Last,
]
  ? [Last] extends [NonNullable<Last>]
    ? Matches<Last, P> extends true
      ? DropFrom<Init, P>
      : Args
    : Args
  : Args;
/** 把形参元组里匹配 `From` 的位换成 `To`（原地换，位置与顺序不变）。 */
type MapIn<Args extends readonly unknown[], From, To> = {
  [Index in keyof Args]: Matches<Args[Index], From> extends true ? To : Args[Index];
};

/**
 * 把每个方法的形参表里**末尾**的 `P` 形参去掉（`P` 走别的通道，例如 `AbortSignal` 走 cancellation）。
 *
 * 只认末尾（见 {@link DropFrom} 的说明）；返回类型原样保留，不碰包装。
 */
export type DropParam<T, P> = {
  [Key in keyof T as T[Key] extends (...args: never[]) => unknown ? Key : never]: T[Key] extends (
    ...args: infer Args
  ) => infer Result
    ? (...args: DropFrom<Args, P>) => Result
    : never;
};

/**
 * 把每个方法的形参表里匹配 `From` 的形参**换成** `To`（例如 lookup：宿主收 `Agent`，wire 传 `SessionId`）。
 *
 * 原地替换，所以 wire 上的实参顺序与宿主方法一致——这正是 wire 协议的形状。
 */
export type MapParam<T, From, To> = {
  [Key in keyof T as T[Key] extends (...args: never[]) => unknown ? Key : never]: T[Key] extends (
    ...args: infer Args
  ) => infer Result
    ? (...args: MapIn<Args, From, To>) => Result
    : never;
};
/**
 * 把每个方法的返回**提升成 `Promise`**（已经是 `Promise<X>` 的原样，不叠两层）。
 *
 * 为什么需要：宿主方法可以同步返回（`CommandRuntime.list` 就是 `readonly CommandDescriptor[]`，
 * `vendor/deepseek-harness/packages/interaction/commands/src/index.ts:315`），而 wire 上每个调用都是
 * **异步**的——网关 `await` 之后才包 `RemoteResult`（同包 `lib/typert.remote-client.ts:150`
 * `Promise<RemoteResult<…>>`）。所以「宿主面 → wire 面」的第三步是 async 化。
 *
 * 只提升成 `Promise`，**不引入 `RemoteResult`**：那是客户端面的包装，本仓的端点契约回裸值。
 */
export type AsyncReturn<T> = {
  [Key in keyof T as T[Key] extends (...args: never[]) => unknown ? Key : never]: T[Key] extends (
    ...args: infer Args
  ) => infer Result
    ? (...args: Args) => Promise<Awaited<Result>>
    : never;
};