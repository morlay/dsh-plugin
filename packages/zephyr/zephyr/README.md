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

### 依赖注入：令牌就是契约

`inject(...)` 拿的是**契约令牌**——本包 `contract/` 里的 `@Injectable() abstract class`，或直接是上游的 Service 类，
不是适配类实例。适配类之间互相注入也用同一个令牌。

```ts
import { SessionPersistence } from "@morlay/dsh-session-persistence"; // 契约在它自己的 contract/ 出口
import { Logger } from "@morlay/zephyr";

@Injectable()
class Greeter {
  // 契约令牌：等它 mount 完成（上游 `[Service.init]()` 结束）后就位。
  sessionPersistence = inject(SessionPersistence);
  logger = inject(Logger);
  meter = inject.optional(TokenMeter); // 可选依赖用 optional，装配里没有就是 undefined
  sinks = inject.all(Sink); // multi 贡献用 all
}
```

- 只 `inject`：不写 `ctx.get(...)`、不用 `providerContext`、不自己 `new InjectionToken`。
- 能力包可以直接 import 它依赖的上游包（那是它的契约面），按用途声明在 `dependencies` / `peerDependencies`。
- 新注入点由**契约所在的包**给出（`contract/` 出口），别在消费方临时造令牌。

### 事件：有主体的、类型化的事件

事件不是字符串，是一个类：名字、参数表、返回类型都在里面。

```ts
// events.ts
export class SessionFlush extends EventEmitter<[SessionId]> {
  constructor() {
    super("session/flush");
  }
}

// 宿主：事件作为字段，`$` 后缀统一表示"这是个事件"
export class PolicyDefault extends Policy {
  readonly flush$ = new SessionFlush();

  onInit(): void {
    this.flush$.on((sessionId) => …);   // 参数表逐事件检查
  }
}
```

- 事件跟着**主体**走：谁产生/谁关心就声明在谁身上，注入到宿主之后自然消费（`app.get(Policy).flush$`）。
- 框架在填充注入后对每个 `EventEmitter` 字段调一次 `onInit(ctx)`——字段式声明不需要额外接线，也不需要装饰器。
- 七种分发模式与 cordis 对齐（`emit` / `parallel` / `serial` / `bail` / `waterfall` / `on` / `onWaterfall` / `once`）；
  事件名就是 cordis 的事件名，所以订阅我们的事件与上游 `ctx.emit("session/flush")` 是同一个事件。

### 域装配函数与 feature

```ts
// 域包：默认清单 + features
export const provideExample = provide([
  configure(StorageDomain, { backend: "rdb" }), // 绑定这一行的默认配置
  StorageJson,
]);

// 装配面：只调 provideXxx，局部改 / 局部删都是 feature
bootstrapApplication({
  providers: [
    ...provideExample(
      configure(StorageDomain, { backend: "jsonl" }), // 改一处（与默认深合并）
      without(StorageJson), // 删一个实现
    ),
  ],
});
```

- **装配面只收 `providers`**：没有 `imports`、没有 Module 容器；依赖靠 `provideXxx()` 内部组合。
- **配置只有 `configure` 一个入口**：对象逐键合并、数组整体替换；Provider 上没有 `withConfig` 方法。
- **`provide(defaults)` 藏住 reduce**：域包写一行，装配面看到的只有 `provideXxx(...features)`。
- 行 id / 包名由 Provider 定义文件所属的 `package.json` 推导。

### 不分运行环境

本包**不按运行环境分面**：宿主与浏览器共用同一个包根（DSL 与装配内核是同一份），cordis 在浏览器里是合法运行期。
面只按用途分（`. ` / `./compat` / `./testing`），取舍见[包出口设计](./.agents/designs/20261113-包出口.md)。

### 文件组织

`src/<domain>/<type>.ts`，一个文件一个 Provider；入口只留 `src/index.ts`（具名导出）与能力包的
`cordis-register.ts`（行入口）。判据见
[`zephyr 装配：怎么写`](./.agents/standards/how-to-write.md)。

公开接口（契约与令牌、注入、装配清单、Provider 与行、上游适配、装配入口、事件、静态依赖检查）见
[`zephyr 的公开接口`](./.agents/designs/20261104-zephyr-是-cordis-plugin-的语法糖.md)；术语见
[`./.agents/GLOSSARY.md`](./.agents/GLOSSARY.md)。

## 验证

```sh
pnpm exec vitest run packages/zephyr/zephyr
```
