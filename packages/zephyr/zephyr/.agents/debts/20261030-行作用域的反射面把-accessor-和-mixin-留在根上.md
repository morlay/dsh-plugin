# 行作用域的反射面把 `accessor` 与 `mixin` 留在根上

状态：未销账（`ctx.reflect.accessor` / `ctx.reflect.mixin` 跑在根反射面，仓内无行内调用方）

**现象**

`packages/zephyr/zephyr/src/service-scope.ts` 里行作用域的 `reflect` 是「真 `ReflectService` 实例的派生对象」：

```ts
reflect: Object.create(Reflect.get(ctx as object, "reflect") as object, {
  get: { value: (name) => lookup(name) },
  provide: { value: (name, value) => provideName(name, value) },
})
```

只有 `get` / `provide` 两个入口被接管（`set` 不接管：上游 `reflect.set` 的三条约束要保住）；`props` / `store` / `accessor` / `mixin` 都直接继承上游实例。

上游 `ReflectService.accessor` 与 `ReflectService.mixin`（`vendor/deepseek-harness/vendor/cordis/src/reflect.ts`）在实现里做两件事：
`this.props[name] = { type: "accessor", … }` 登记声明，`this.ctx.fiber.effect(...)` 登记注销。派生对象上的 `this` 是派生对象本身，
而 `this.ctx` 仍是 `ReflectService` 所属的那一个根 ctx。于是：

- `ctx.reflect.accessor(name, …)` / `ctx.reflect.mixin(…)` 的声明写进**根** `props`，注销挂在**根** fiber；
- 行卸载时这两个声明不会被摘掉，只有根卸载才摘；
- 与之并列的 `ctx.accessor(...)`：行作用域代理的 `get` 走 `prop in ctx` 分支，取到的是绑在行 ctx 上的取用函数，
  注销落在**行** fiber。同一行里两个入口的生命周期语义不同。

`props` 本身是同一个 `ReflectService` 实例的字段，全树共享：两条路径写进去的声明都跨行可见。

**影响**

行内 accessor / mixin 的隔离与生命周期语义与 `ctx.effect` 不一致：写声明跨行可见，撤销却分属两个 fiber。
`ctx.reflect.props` 不是纯内部字段——cordis 的属性解析按 `props` 分派（`vendor/deepseek-harness/vendor/cordis/src/reflect.ts` 的
`ReflectService.handler`），上游 `vendor/deepseek-harness/packages/api/gateway/src/index.ts` 的 `collectSrcClaims` 与同文件另一处遍历
也按 `ctx.reflect.props` 枚举声明面。行内写进根 `props` 的 accessor 会进入这些枚举。

当前没有任何行内调用方（`packages`、`apps` 两个目录下 `ctx.reflect.accessor` / `ctx.reflect.mixin` 零命中），所以没有可观察错误。

**触发条件**

任一行内上游插件调用 `ctx.reflect.accessor(name, …)` 或 `ctx.reflect.mixin(…)`。

**销账条件**

Done when：其中一个成立——

1. 这两个入口也转发到本行作用域：声明写本行 props 视图，注销进本行 `effects` 栈，并有 spec 断言「行卸载后声明消失、根仍在」；
2. 行作用域的能力清单显式声明「不支持 `reflect.accessor` / `reflect.mixin`」，且有 spec 断言调用会被拒绝。

**不修的理由**

做第 1 条要先决定「本行 props 视图怎么与根 `props` 合并 / 遮蔽」：上游按 `ctx.reflect.props` 枚举声明面、cordis 按 `props` 解析属性、
`ctx.reflect.store` 与 `props` 是两套键，任一处读错都会变成「属性读不到」或「读到别人行的声明」。现在没有调用方，留空位比先猜一套合并规则便宜。
