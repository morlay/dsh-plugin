# zephyr 的公开接口（cordis plugin 的 DSL）

运行期语义完全由 cordis 决定。zephyr 只提供两件事：**强类型约束**、**静态依赖检查**。
本文只定义接口——每个接口给签名、语义与约束；不描述实现现状。

## 一、契约与令牌

```ts
@Injectable()
abstract class SessionController {
  abstract list(): Snapshot<string[]>;
  abstract retain(id: string): void;
}
```

- 契约类是**唯一**的令牌类型：既是 `inject` 的目标，也是 `app.get` 的参数。
- 服务名 = 契约类名的连字符形式（`SessionController` → `session-controller`）。这个名字同时是
  cordis 的服务名与 dsh 行 id，不需要另外声明。
- 契约只声明面，不含实现；实现类只出现在 `provide([...])` 的清单里。

**多值契约**在声明处定：`@Injectable({ multi: true })`。它决定这个令牌的注入形态（见第二节）与注册规则
（见第三节），不需要在提供端或注入端再作说明。

**约束**：可作为注入目标的值必须是 `@Injectable() abstract class`。实现类、纯值、上游内部服务名都不是注入目标。

**纯值配置**用 `InjectionToken`：

```ts
export const APP_ENV = new InjectionToken<AppEnvValues>("appEnv");
```

名字就是 cordis 服务名；注入点拿到 `AppEnvValues` 类型。上游自己也用这种形态装纯值配置，两边一致。

## 二、注入

```ts
class Foo {
  /** 必需依赖：缺失即装配失败。 */
  private readonly sessions = inject(SessionController);

  /** 可选依赖：没装即 `undefined`，装了但未就绪仍算装配失败。 */
  private readonly titles = inject.optional(SessionTitle);

  /** 多值依赖：只对 `@Injectable({ multi: true })` 的令牌合法，按注册顺序给出全部实现。 */
  private readonly plugins = inject.all(SessionHook);
}
```

- 返回类型就是契约类型（`inject(X): X`），不经过 `unknown` / `any`。
- 依赖在**字段声明处**给出；不写 `static inject` 数组，不在运行期按字符串取服务。
- `inject` 的求值发生在装配阶段，早于任何 `onInit`。
- 用错形态在装配前就报错：`inject` 用在 multi 令牌上、`inject.all` 用在单值令牌上，都拒绝启动。

## 三、装配清单

```ts
// 清单只放条目：默认配置写在条目上，或由实现类的 Config 给默认值
export const provideSession = provide([
  SessionStoreDefault,
  { provide: SessionQueryDefault, config: { retentionDays: 30 } },
]);

// configure / without 是**调用方**的 feature，不混进清单
bootstrapApplication({ providers: [...provideSession(without(SessionHookDefault)), FooBar] });
```

- `provide([...清单])` 返回 `(...features) => ProviderEntry[]`；一个域只暴露一个 `provideXxx`。
- `configure(实现类, patch)`：按实现类定位清单条目，把 patch 与该条目的 config 深合并后替换
  （对象逐键合并，数组整体替换）。
- `without(实现类)`：从清单里剔除该条目。
- **清单只收 DSL 形态**：Provider 类、`{ provide }` 条目、`toCordis()` 的产物。混写 feature 或直接塞裸
  cordis 插件都会被拒绝——那等于绕过 DSL 自己拼装配，依赖、生命周期、契约面都不在类型与静态检查范围内。
- 清单是装配的**静态真源**：谁提供什么，从这份清单可读，不依赖运行期发现。
- 多值令牌的实现直接并列写在清单里（`provide([HookA, HookB])`）；它们不占用单值服务名，
  注入端用 `inject.all(Hook)` 按清单顺序取到 `[HookA, HookB]`。

## 四、Provider 与行

```ts
@Injectable()
class SessionStoreDefault extends SessionStore implements OnInit, OnDispose {
  onInit(ctx: Context): void {
    // ctx 就是 cordis 子 ctx：provide / get / inject / effect / isolate 都是 cordis 原生行为
  }

  onDispose(): void {}
}

export default toCordis(SessionStoreDefault, { Config });
```

- `onInit(ctx)` 拿到的 ctx 是 cordis 子 ctx；服务注册、作用域、effect 收尾都用 cordis 原生能力。
- `onDispose()` 在 `ctx.effect` 的收尾阶段执行，此时依赖仍可读。
- `toCordis(Provider, options)` 把 Provider 转成 cordis 插件对象（`name` / `inject` / `apply`）；
  行 id 由 token 名派生，不由它决定。

## 五、上游插件适配

```ts
/** 把上游插件包成 Provider：契约给出类型面，上游实例给出实现。 */
@Injectable()
class SessionTitleRow extends fromCordis(SessionTitle, UpstreamSessionTitle) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessions, llm });
  }
}
```

- `fromCordis(契约, 上游插件)` 生成的类**只做类型面桥接**：`inject(契约)` 拿到的面对象转发到上游实例。
- `mount(ctx, config?, deps?)` 的 `deps` 是显式依赖表——上游 `inject` 声明里要的东西都从这里给；
  缺哪一项在 `mount` 时立即报错，不静默 `undefined`。
  **deps 只在读取时替换，不注册进 cordis**：它适用于"上游在 `apply` 现场按名字读"的场景；
  上游若把 ctx 转交给 cordis 内部（`ctx.plugin(带 static inject 的类)` 建实例），那里读的是 store，
  deps 不生效——这类依赖必须由清单里的行提供，不是塞进 deps。
- **配置三层**：适配行的 `static defaultConfig` → 行配置（清单条目 `{ provide, config }`）→ 上游
  `static Config` 的 schema 默认值。前两层深合并（对象逐键、数组替换），第三层由上游 schema 补齐。
- 上游在自己的 `apply` 里 `ctx.provide(name, …)` 的名字直接留在 cordis store；
  `ctx.get(name)` 与我们的 `inject(契约)` 指向同一个条目。

## 六、应用入口

```ts
const app = await bootstrapApplication({
  providers: [...provideSession(), ...provideWeb()],
  timeoutMs: 60_000,
});

app.get(SessionController);        // 必需：没有就抛
app.tryGet(SessionTitle);          // 可选：没有给 undefined
app.getAll(SessionHook);           // 多值
```

- 启动语义：清单按声明顺序串行激活；任一 `onInit` 抛错则已启动的逆序卸载，应用不返回。
- `App` 只是根 ctx 与清单的持有者；诊断、观测这类能力都是插件，不挂在 `App` 上。

## 七、诊断与日志

`Logger` 契约包的是 **cordis 原生 logger**（`ctx.logger`）：`bootstrapApplication` 把它直接装进清单，
`inject(Logger)` 拿到的就是 `ctx.logger`，不另造日志服务。

## 八、诊断

```ts
@Injectable()
abstract class Debugger {
  /** 装配快照：每行启动结果、服务名清单、令牌清单。 */
  abstract diagnostics(): DebugSnapshot;
}

interface DebugSnapshot {
  readonly rows: readonly { name: string; state: "started" | "failed"; reason?: string }[];
  /** cordis store 里的服务名。 */
  readonly names: readonly string[];
  /** 可注入的令牌名。 */
  readonly tokens: readonly string[];
}

app.get(Debugger).diagnostics();
```

- `Debugger` 是一个普通契约：`bootstrapApplication` 默认把 `DebuggerDefault` 装进清单，装配面可以 `without(Debugger)` 剔除。
- 判断口径：区分「行没启动」与「行启动了但服务没发布」——这是装配期最常见的两类失败。
- 任何观测能力都走这条路（契约 + Provider），不往 `App` 上加方法。

## 九、静态依赖检查

两半，接口层各有一处：

**编译期**：`inject(Token)` 的返回类型带必需品牌（`T & Required<T>`）；`bootstrapApplication<const L>` 从清单里
每个 Provider 的实例上收集必需令牌，与清单能提供的实例做子类型比对，缺的塞进 `options.__missingProviders`
（必填字段）——调用处因此编译失败，错误信息里直接是缺的令牌类型。

```ts
// @ts-expect-error 缺 `Greeter` 的提供者：编译期报 `__missingProviders: Greeter`
bootstrapApplication({ providers: [Early, Needs] })
```

限制：`provide(...features)` 的返回类型沿用原始清单，`without()` 剔掉的条目在类型层仍算"提供过"——
保守方向（漏报，不误报）。`inject.optional` / `inject.all` 不参与这项检查：前者可缺，后者允许空。
覆盖不了的情况（动态 providers）留给下一半。

**装配前**：`bootstrapApplication` 在激活任何行之前，把清单能提供的令牌集合与所有 Provider 的
`inject` / `inject.optional` / `inject.all` 声明做比对：

- 必需依赖缺失 → 拒绝启动，报出「哪个 Provider 需要哪个令牌、清单里有没有接近的拼写」；
- 可选依赖缺失 → 正常启动，该字段为 `undefined`；
- 多值依赖无实现 → 空数组。

运行期不再做 token 校验（最多留开发期断言）。

## 十、事件

事件也是类型化的：名字、参数表、返回类型收在一个类里，订阅与发布都走它，`ctx.on("字符串")`
只作为底层实现存在。

```ts
abstract class EventEmitter<in out TArgs extends unknown[] = [], in out TResult = void>
  implements OnInit {
  protected constructor(readonly name: string);

  onInit(ctx: Context): void;

  /** 广播：所有监听者同步跑一遍，返回值忽略。 */
  emit(...args: TArgs): void;
  /** 并行：所有监听者并发跑，全部结束后 resolve。 */
  parallel(...args: TArgs): Promise<void>;
  /** 串行：按注册顺序逐个跑，返回最后一个监听者的结果。 */
  serial(...args: TArgs): Promise<TResult>;
  /** 短路：遇到第一个非 `undefined` 的结果就返回。 */
  bail(...args: TArgs): TResult;
  /** 瀑布：监听者的返回值经 `next()` 决定是否继续。 */
  waterfall(...args: TArgs): TResult;

  /** 订阅。 */
  on(listener: (...args: TArgs) => TResult, options?: EventOptions): () => boolean;
  /** 订阅瀑布监听者（比 `on` 多一个 `next`）。 */
  onWaterfall(listener: (...args: [...TArgs, Next<TResult>]) => TResult, options?: EventOptions): () => boolean;
  /** 订阅一次。 */
  once(listener: (...args: TArgs) => TResult, options?: EventOptions): () => boolean;
}
```

语义与约束：

- `TArgs` 是**参数表**，不是单个 payload：无参事件用默认的 `[]`，多参事件写 `[SessionId, boolean]`。
  参数个数与类型因此逐事件独立。
- `TResult` 是监听者的返回值，`serial` / `bail` / `waterfall` 用得到；`emit` / `parallel` 忽略它。
- 七种分发模式与 cordis **一一对齐**：语义全由 cordis 决定，zephyr 只补类型和"从哪个 ctx 走"。
- 事件对象是**宿主 Provider 的字段**，`$` 后缀统一表示"这是个事件"：

  ```ts
  class Policy {
    readonly flush$ = new SessionFlush();
  }

  app.get(Policy).flush$.emit();
  ```

  框架在填充注入之后对每个 `EventEmitter` 字段调一次 `onInit(ctx)`，字段式声明因此也能拿到本行 ctx。
- 事件**子类**只是普通类：不需要 `@Injectable()`，也不是 Provider——它是字段值。
- 事件名是 cordis 的事件名（`super("session/flush")`），所以订阅我们的事件与上游的派发是同一个事件。
- 事件类放在包的 `events.ts`，出口统一挂命名空间：`export * as Events from "./events.ts"`。

## 不做的事

- 不维护第二套服务名表：cordis store 是唯一注册表。
- 不造 ctx 代理：行 ctx 是 cordis 子 ctx。
- 不做运行期反射发现：提供关系由清单静态决定。


