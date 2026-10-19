# @morlay/zephyr

类型安全的 cordis 适配层：在 `@deepseek-ai/cordis` 之上提供类式依赖注入（`@Injectable` / `inject` / `EventEmitter`），
同时把 Provider 转成 dsh 的 cordis 插件行（`toCordis()`）。装配单位是 **provider 清单**（Standalone，没有 Module 容器）。

## 用法

### 一个 Provider

```ts
import { fromCordis, Injectable, inject, toCordis, type Context } from "@morlay/zephyr";

@Injectable()
class Clock extends fromCordis(ClockService, ClockPlugin) {
  // 依赖名要与上游 `static inject` 声明的名字一致（这里上游声明的是 `logger`）。
  logger = inject(Logger);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { logger: this.logger });
  }
}

// 行入口：dsh Loader 取 default export；`Config` 是行插件的配置 schema（可选）。
export default toCordis(Clock, { name: "clock" });
```

**`fromCordis(令牌, 上游插件)`**（两参）：第一个参数是**要绑定的令牌**，第二个是接管实现的**上游插件**；
只给一个参数时令牌就是那个上游插件类自身。适配类实例只是占位，`mount()` 完成（上游 `[Service.init]()` 结束）
后 `inject(令牌)` 拿到的是**上游实例**。

- 自动判定看的是**第二个参数（上游插件）**：它是 `Service` 子类时，适配类自动把服务名接管到根 ctx
  （`super(ctx, name)` 那一套对兄弟行可见），不用写 `{ nativeProvide: true }`；只有**函数插件自己
  `ctx.provide(name, …)`** 的场景才显式开。
- `mount()` 的第二个参数是**依赖**，必须由本类的字段 `inject(...)` 显式给出并如实传入。
  我们**不读**上游的 `static inject` 做隐式补齐：缺了就是 `mount() … is missing declared dependencies`。

### 依赖注入只认契约

能力包**不 import `@deepseek-ai/*`**：契约由聚合层透出，消费侧只从 `@morlay/dsh-base/*` 拿令牌。

```ts
import { SessionPersistence } from "@morlay/dsh-base/session";   // 上游契约类，经聚合层透出
import { TokenMeter } from "@morlay/dsh-base/token-meter";       // 同上：不要写 @deepseek-ai/* 的路径
import { Logger } from "@morlay/zephyr";

@Injectable()
class Greeter {
  // 注入的是**契约令牌**（聚合层透出的上游类 / 适配令牌），不是适配类实例；
  // 裸上游 Service 类也能注入：按实例类型等它 mount 完成（`[Service.init]()` 结束）后就位。
  sessionPersistence = inject(SessionPersistence);
  logger = inject(Logger);
  meter = inject.optional(TokenMeter); // 可选依赖用 optional，装配里没有就是 undefined
  sinks = inject.all(Sink);            // multi 贡献用 all
}
```

- 能力包只 `inject`：不写 `ctx.get(...)`、不用 `providerContext`、不自己 `new InjectionToken`。
- 需要新的注入点由**聚合层**（`@morlay/dsh-base/*`）透出。
- 适配类之间互相注入也用**契约令牌**；聚合层只负责「把契约透出成自己的出口 + 提供实现」。

### jsExpr：同一份配置同时服务 patch 与装配

```ts
configure(StorageJson, { root: jsExpr(() => dshHomePath("storages")) });
```

`jsExpr` 在构建期渲染成 `!!js` 表达式，在运行期按行 ctx 求值（行 ctx 的读面会回退根 ctx，
所以 `jsExpr((ctx) => ctx.webStartup.port)` 这类写法在代码组合里也成立）。

**`useValue` 是 Provider 的「配置」，不是「令牌值」**：要对外提供值用 `useFactory`。

```ts
{ provide: ClientRowsToken, useFactory: () => rows }   // ✅ 令牌值
{ provide: ClientRowsToken, useValue: rows }           // ❌ 会被当成 Provider config
```

### 域装配函数与 feature

```ts
// 域包：默认清单 + features
export const provideExample = provide([
  configure(StorageDomain, { backend: "rdb" }),   // 绑定这一行的默认配置
  StorageJson,
]);

// 装配面：只调 provideXxx，局部改 / 局部删都是 feature
bootstrapApplication({
  providers: [
    ...provideExample(
      configure(StorageDomain, { backend: "jsonl" }),  // 改一处（与默认深合并）
      without(StorageJson),                            // 删一个实现
    ),
  ],
});
```

- **装配面只收 `providers`**：没有 `imports`、没有 Module 容器；依赖靠 `provideXxx()` 内部组合。
- **配置只有 `configure` 一个入口**：对象逐键合并、数组整体替换；Provider 上没有 `withConfig` 方法。
- **`provide(defaults)` 藏住 reduce**：域包写一行，装配面看到的只有 `provideXxx(...features)`。
- 行 id / 包名由 Provider 定义文件所属的 `package.json` 推导。

### 文件组织

`src/<domain>/<type>.ts`，一个文件一个 Provider；入口只留 `src/index.ts`（具名导出）与能力包的
`cordis-register.ts`（行入口）。判据见
[`zephyr 装配结构与命名`](./.agents/standards/zephyr-assembly.md)。

双向适配的边界、服务表挂根 ctx、bundle 的 patch 生成见 [`./.agents/designs/`](./.agents/designs/)；
术语见 [`./.agents/GLOSSARY.md`](./.agents/GLOSSARY.md)。

## 验证

```sh
pnpm exec vitest run packages/zephyr/zephyr
```
