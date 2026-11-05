// 契约覆盖守卫：本仓的契约是上游服务的投影，**成员一个都不能少**——上游插件按
// `ctx.<service>.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
//
// 判据只取字符串键：cordis `Service` 基类的 `name` 与各个 symbol 键（`[symbols.config]` 等）
// 不属于服务自己的面。

/** 上游服务自有公开成员里，契约没列出的那些；`never` 表示覆盖完整。 */
export type Uncovered<Upstream, Contract> = Exclude<
  Extract<keyof Upstream, string>,
  "name" | keyof Contract
>;

/**
 * 把「没覆盖到的成员」变成编译约束：为 `true` 才通过，否则报错并列出漏掉的成员名。
 *
 * ```ts
 * export type XxxCovered = AssertTrue<AssertCovered<UpstreamService, XxxFace>>;
 * ```
 */
export type AssertTrue<T extends true> = T;

export type AssertCovered<Upstream, Contract> =
  Uncovered<Upstream, Contract> extends never ? true : Uncovered<Upstream, Contract>;
