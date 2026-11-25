// 契约覆盖守卫：本仓的契约是上游服务的投影，两层都要钉住——**成员一个都不能少**（上游插件按
// `ctx.<service>.<member>` 取用，缺一个那条插件在运行期就是 `undefined`），且**同名成员的签名要能赋值**
// （形状不同时键还在，运行期读到的是 `undefined` 或错的行，编译期一声不响）。
//
// 键判据只取字符串键：cordis `Service` 基类的 `name` 与各个 symbol 键（`[symbols.config]` 等）
// 不属于服务自己的面。
//
// 判据只有一种形态 {@link AssertCoveredStrict}。**没有"只核键"的弱变体**：那种守卫看起来在守、其实守不住，
// 只能诱导人以为对齐了；确实只能核键的场合请用 `as` / 局部断言，别造一个假守卫。
//
// 两种写法，按**上游那份是什么**选：
//   - 契约覆盖上游**全部**成员、且上游是 `interface` → 直接 `class X implements Upstream`（或
//     `interface X extends Upstream`）。编译器自己会报缺成员与签名不符，别再加守卫。
//   - 只覆盖**一部分**（内部态不进契约），或上游是 cordis `Service` **类**（带私有成员，`implements`
//     会报 TS2720）→ 用 {@link AssertCoveredStrict}，并在契约上方写清是哪种情况、覆盖了多少。

/** 上游服务自有公开成员里，契约没列出的那些；`never` 表示覆盖完整。 */
export type Uncovered<Upstream, Contract> = Exclude<
  Extract<keyof Upstream, string>,
  "name" | keyof Contract
>;

/**
 * 把判据结果变成编译约束：为 `true` 才通过，否则报错并列出成员名（诊断的第二行会给出具体成员）。
 *
 * ```ts
 * export type XxxCovered = AssertTrue<AssertCoveredStrict<UpstreamService, XxxFace>>;
 * ```
 */
export type AssertTrue<T extends true> = T;


/** 上游成员里，契约同名成员**赋值不过去**的那些（契约的值放不进上游要求的位置）；`never` 表示全可赋值。 */
export type Unassignable<Upstream, Contract> = {
  [K in keyof Upstream & keyof Contract]: [Contract[K]] extends [Upstream[K]] ? never : K;
}[keyof Upstream & keyof Contract];

/**
 * 把「同名但类型对不上」变成编译约束：为 `true` 才通过，否则报错并列出成员名。
 *
 * 方向是**单向**的「契约的成员值能放进上游那个位置」（`Contract[K] extends Upstream[K]`）：
 * 返回值更窄、参数更宽都算通过——那正是"契约是上游投影"应有的方向。双向可赋值会误报：
 * 上游的可选参数、重载与 branded id 让很多**正确**的收窄过不去。
 *
 * 两层都要过：键不全时报缺的键，键全但同名类型对不上时报那些成员名。
 */
export type AssertCoveredStrict<Upstream, Contract> =
  Uncovered<Upstream, Contract> extends never
    ? Unassignable<Upstream, Contract> extends never
      ? true
      : Unassignable<Upstream, Contract>
    : Uncovered<Upstream, Contract>;
/** 一个方法的形参元组 / 返回类型。 */
type ParamsOf<Method> = Method extends (...args: infer Args) => unknown ? Args : never;
type ReturnOf<Method> = Method extends (...args: never[]) => infer Result ? Result : never;

/**
 * 一个成员对上 wire 面了吗：**形参双向**、返回单向。
 *
 * **为什么不能用 `implements`**：`implements` 与 `AssertCoveredStrict` 是**同一个关系**（「我的成员能放进面里」），
 * 而形参在参数位置是**逆变**的——放宽永远合法。实测：
 * ```ts
 * interface Face { execute(atts: readonly Attachment[]): void }
 * class Widened implements Face { execute(_atts: readonly unknown[]): void {} }   // 不报错
 * ```
 * 所以 `_submittedAttachments: readonly unknown[]` 在 `implements` 下是绿的，双向判据才红。
 *
 * **形参与返回都双向**：`AssertCoveredStrict` 只判「契约能放进上游那个位置」，于是**宽化**看不见——
 * `_submittedAttachments: readonly unknown[]` 收得下 wire 的 `readonly CommandSubmitAttachment[]`，
 * 单向比较一路绿灯，而契约这时已经不再描述协议（`commands` 就这么漏过一次）。wire 的形参是协议，
 * 宽一点都不行；返回同样双向（wire 的响应形状是**协议**，说窄了就是撒谎：消费方会按契约少判一次
 * `undefined`）。要表达「我们不返回 undefined」就改契约，或者让实现在类型上就是那个窄类型——不要靠守卫放水。
 */
type WireMemberOk<Face, Contract> = [ParamsOf<Face>] extends [ParamsOf<Contract>]
  ? [ParamsOf<Contract>] extends [ParamsOf<Face>]
    ? [ReturnOf<Contract>] extends [ReturnOf<Face>]
      ? [ReturnOf<Face>] extends [ReturnOf<Contract>]
        ? true
        : false
      : false
    : false
  : false;

/** 形参宽窄不等 / 返回放不进去的成员（诊断用）。 */
export type MismatchedWireMembers<Face, Contract> = {
  [Key in keyof Face & keyof Contract]: WireMemberOk<Face[Key], Contract[Key]> extends true
    ? never
    : Key;
}[keyof Face & keyof Contract];

/**
 * **wire 面守卫**：键要覆盖（同 {@link AssertCoveredStrict}），且每个同名成员的**形参双向相等**、
 * 返回可比上游更窄。用于「契约就是 wire」的端点契约（上游宿主类的投影见 `typert/params.ts`）。
 */
export type AssertWireFace<Face, Contract> = Uncovered<Face, Contract> extends never
  ? MismatchedWireMembers<Face, Contract> extends never
    ? true
    : MismatchedWireMembers<Face, Contract>
  : Uncovered<Face, Contract>;