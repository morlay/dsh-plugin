# zephyr 装配：怎么写

面向写能力包与适配行的人。框架内部的判据归 `src/__tests__/` 与 `src/compat/__tests__/`（见[如何验证](./how-to-verify.md)）；
接口定义见[设计 zephyr 的公开接口](../designs/20261104-zephyr-是-cordis-plugin-的语法糖.md)。

## 文件布局

能力包（`packages/<family>/<pkg>/src/`）按「契约 / 宿主 / 端点」分目录，一个类型一个文件：

```text
src/contract/<x>.contract.ts   契约：@Injectable() abstract class（令牌）
src/contract/events.ts         事件类（EventEmitter 的子类）
src/contract/index.ts          只转出本包契约
src/server/<x>.service.ts      实现：<X>Default（一个文件一个类型）
src/server/<domain>.provide.ts 域装配函数：provide([...]) → 域外只调 provideXxx()
src/endpoint/<x>.ts            wire 契约（浏览器半与宿主半共同的那层，可选）
src/index.ts                   包门面：只具名导出
```

- **契约与实现分开住**：契约在 `contract/`、实现在 `server/`；契约是令牌，实现只出现在 `provide([...])` 的清单里。
- **一个文件一个类型**：不把多个上游插件塞进同一个文件。
- **域装配函数是唯一装配面**：`export const provideXxx = provide([...])`，装配面只写 `...provideXxx(...features)`。

## Provider

```ts
@Injectable()
class SessionStoreDefault extends SessionStore implements OnInit, OnDispose {
  private readonly sessions = inject(SessionController);

  onInit(ctx: Context): void {
    // 注册服务、挂行为都走 cordis 原生 ctx
  }

  onDispose(): void {}
}
```

- 依赖写成**字段注入**：`inject(Token)` / `inject.optional(Token)` / `inject.all(Token)`；不写 `static inject` 数组、不按 `ctx.get("名字")` 取服务。
- 只注入**契约**（`@Injectable() abstract class` 或 `./compat` 给的令牌）；实现类只出现在清单里。
- 配置类型从 `static Config` 或**构造参数**推导（`static Config` 优先）；两样都没有时是 `unknown`，`configure` 也就不接受任何字段——要可配就写构造参数或 `static Config`。
- 多值令牌的实现类**再写一次 `@Injectable({ multi: true })`**：`multi` 不会随继承自动带上，漏写会让它变成单值令牌（第二个实现静默覆盖）。契约上写 `@Injectable({ multi: true })` 只管令牌形态。
- 生命周期承诺：`onInit` 抛错 → 应用不启动、已启动的行逆序卸载；`onDispose` 执行时依赖仍可读。
- `inject.optional(X)` 只在「装配里根本没有 X」时给 `undefined`；有提供者但未就绪与必填一样等。

## 适配行（`./compat`）

```ts
@Injectable()
class SessionStatsDefault extends fromCordis(SessionStatsPlugin) {
  private readonly projections = inject(SessionProjectionStore);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessionProjections: this.projections });
  }
}
```

- `fromCordis(契约, 上游)` / `fromCordis(上游)` / `fromCordis(契约)` 三形态：契约面来自上游发布的服务；单参是上游时令牌从包名派生；单参是契约时是纯实现行。
- `mount(ctx, config?, deps?)` 的 **deps 只在读取时替换**，不注册进 cordis：上游在 `apply` 现场按名字读的东西从 deps 给；上游把 ctx 交给 cordis 内部（`ctx.plugin(带 static inject 的类)`）时它读的是 store，deps 不生效——那类依赖必须由清单里的行提供。
- **`onInit` 里必须 `mount`**：忘了 `mount` 的适配行在装配期就报错（契约面为空），不会把空壳漏给消费方。
- `toCordis(Provider, { Config? })` 只用于「按 cordis 行装配」的部署与搬过来的 spec（例：`packages/agent-ex/better-session/src/cordis.ts`）。生产装配面走 `provideXxx()`，不需要行入口。
- `toCordis` 的 `Config` 必须是 cordis 的 schema（`~standard.validate`）；普通规范化函数不要传，会在 `resolveConfig` 里炸。

## 令牌

- **服务令牌写真实类型**：契约类就是令牌；`InjectionToken` 只用于没有服务类型的纯值配置。
- **多值令牌在声明处定**：契约 `@Injectable({ multi: true })`，注入端 `inject.all(Token)`。
- **上游别名**：上游按驼峰名严格读我们的服务时（`sessionPersistence` / `settings`），在契约上写 `@Injectable({ name: "sessionPersistence" })`，装配时按别名再发布一份。

## 事件

- **事件是一个类，不是字符串**：`class SessionFlush extends EventEmitter<[SessionId]> { constructor() { super("session/flush"); } }`。名字拼错、参数不符、回调签名不符都在编译期报出来。
- **参数表写在泛型里**：`EventEmitter<[SessionId, boolean]>` 是**参数表**，不是单个 payload；无参事件不写泛型。返回值用第二个泛型。
- **事件挂在宿主上，字段名带 `$`**：`readonly flush$ = new SessionFlush()`；装配时框架对每个 `EventEmitter` 字段调 `onInit(ctx)`，不需要额外接线。
- **事件类不标 `@Injectable()`**（字段形态）；要当装配行时它和普通 Provider 一样进清单。
- **瀑布用 `onWaterfall`**：监听者比 `on` 多一个 `next`，用错方法编不过。
- **事件类放包的 `events.ts`，出口挂命名空间**：`export * as Events from "./events.ts"`（例：`packages/agent/dsh-session/src/contract/index.ts`）。

## 边界

- **本包不按运行环境分面：包根两端共用**。两端的装配入口都从包根取 DSL 与装配内核（cordis 在浏览器里是合法
  运行期）；没有"浏览器专用"说明符，判据在 `src/__tests__/entry-shape.spec.ts`，取舍见[包出口设计](../designs/20261113-包出口.md)。
- **不拿"浏览器专用面"兜别人的宿主泄漏**：上层若把只属于宿主的包根引进浏览器图，症状是构建期
  `MISSING_EXPORT`（`node:*` 具名导出在替身里不存在），修法在上层换说明符或改值转出——本包不加分面去绕。
- **不引入全局共享状态**：运行上下文只由配置构造（`AppEnv` 这类值在装配入口显式给）；不在模块作用域存可变单例、不读进程级环境变量做隐式配置。
- **声明式边界**：业务包只写 `@Injectable()` + 字段注入 + `provide([...])` + `fromCordis`；命令式读取（`ctx.get` / 手工 `provide` / `ctx.inject`）只允许出现在框架与聚合层的适配代码里。
- **装配错在启动前暴露**：令牌没有提供者时，装配阶段就失败并报出「谁需要谁」；编译期 `ProvidersCoverage` 再挡一次。
