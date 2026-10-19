# 我们自己的插件用 class Provider，不用 nativePlugin 包对象插件

状态：已采纳

背景：引入 zephyr 时，两个试点最初把现有 `apply` 函数用 `nativePlugin()` 包成 Provider。这能跑，但把我们自己的插件退回到「对象插件 + apply 函数」的形态，丢掉了 `@Injectable()` class 的构造注入、`onInit` / `onDispose` 生命周期与 token 身份。包一层上游插件的职责不属于我们自己的插件写法。后续 `nativePlugin` 已删除：上游插件直接作为 `providers` 的一项，由行运行时装载；本决定不受影响。

**决定**

本仓库的能力包一律写 `@Injectable()` class Provider：构造参数接收行 Config，`onInit(ctx)` 挂行为/注册服务，需要清理的资源用 `onDispose()`；入口 `export default toCordis(ProviderClass, { Config })`。上游原生插件直接作为 `providers` 的一项，不包成 Provider。

**考虑过的选项**

- 包一层对象插件（原 `nativePlugin()`）：迁移量小，但自己的插件没有 class 身份与生命周期，还把「上游适配」与「我们插件」混成一套写法。
- 直接导出 `apply` 函数：回到 dsh 对象插件，zephyr 的注入与生命周期用不上，等于只引了个 `toCordis` 外壳。

**后果**

- 能力包入口是 class + `toCordis`；行 id 仍是 token 名（类名 hyphenate）。
- 行为逻辑从 `apply` 迁到 `onInit`；注册类副作用（`ctx.web.registerSearchProvider`、上游 `Service` 构造）随行 ctx 卸载。
- 测试挂载接缝用 `ctx.plugin(plugin.default, config)` 或 `plugin.default.apply(ctx, config)`，不再把命名空间当插件。
