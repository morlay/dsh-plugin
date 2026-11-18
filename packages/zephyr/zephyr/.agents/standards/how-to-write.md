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
- **`reflect.provide(name, value)` 在装配期是一等形态——但只在装配期**：`bootstrapApplication` 会在每一行
  `onInit` 之后（`src/bootstrap.ts` 的 `adoptNamedServices`）与全部装配完之后各扫一次 cordis store，把
  `name → 令牌` 对上补进令牌表，所以「装配期按名字发布」的实例，`inject(Token)` 一样拿得到（上游在自己 `apply`
  里按名字发布的服务就靠这两次扫描接上）。**缺口只在「晚于装配期」**：两次扫描之后才 `provide` 的名字不会被
  采纳，那时的 `inject(Token)` 拿不到——要晚发布，就得给它一个令牌/DSL 形态，而不是靠名字。
  两种正当用法（都出现过，别再各判一遍）：**上游发 → 我们采纳**（适配行、`sidebarRightTabs` 这类无行的能力）；
  **我们发 → 上游按名字读**（`storage.backend.rdb` 这类上游协议 key，名字由上游的拼法函数给出，没有令牌可选）。
- **`inject` 定的是「怎么读」，「谁先」由「清单里有没有以它为令牌的行」决定**：`orderByDependencies`
  只按令牌找行（`src/bootstrap.ts` 的 `byToken`），所以同一个 `inject(Token)` 有两种顺序语义：
  - **有一行以它为令牌**——`{ provide: Token, … }` 条目、`@Injectable()` 的实现类行、`fromCordis(契约, 上游)`
    的适配行（令牌就是契约，面在 `bindFace` 里换上）——依赖边成立，拓扑排序把提供方排在消费者之前，
    **清单里怎么写都行**。
  - **值令牌没有行**——`InjectionToken`，或抽象面由某个上游行在 `onInit` 里 `reflect.provide(name, …)`
    发布、清单里没有以它为令牌的条目——**没有依赖边**，`inject(Token)` 只是把读法从 `ctx.get(name)` 换成
    类型面，**顺序仍靠清单行序**：消费者排在发布方之前，装配期报「没有提供者：<名字>」（`ctx.get(name)`
    时代是 `onInit` 里读不到——同一个前提，只是报错更早、更指得出是谁）。
    例：`sidebarRightTabs`（值令牌，注册表由 `packages/agent/dsh-conversation/src/ui/shell/sidebar-right-slots.ts`
    那行 `mount` 时发布，所以 `provideSessionShellSlots()` 里发布方排在消费行之前是**前提**）与 `fileDrag`
    （类令牌 `FileDragDefault`，清单里就是一行，排哪都行）。
    与上一条是同一件事的两面：上一条管「**晚于装配期**发布的不被采纳」，这一条管「**装配期内但晚于消费者**
    发布的值令牌要靠行序」。
  - **判据（两种，任选其一）**：① 读清单——这个令牌有没有一行以它为 `provide:` / 实现类 / 适配行的契约？
    有就是依赖图，没有就是行序。② 运行期——把一个消费者挪到发布方之前重跑装配：有边的会自己排回来
    （照常起来），没边的报「没有提供者：<名字>」。
- **装配错在启动前暴露**：令牌没有提供者时，装配阶段就失败并报出「谁需要谁」；编译期 `ProvidersCoverage` 再挡一次。

## 禁止按名字读服务（cordis 老写法）

**任何业务代码都不许按名字读服务**：`ctx.get("name")` / `ctx.reflect.get("name")` / `ctx.reflect.provide("name", v)` 全部禁止。
它们是 cordis 的老写法——名字是字符串、没有类型、拼错要到运行期才发现，而且读回来只能是 `any`/`unknown`，
调用方只能 `as unknown as` 收窄。

**唯一允许的位置**：框架层实现内部（`zephyr/src/bootstrap.ts` 的 `adoptNamedServices`、`zephyr/src/compat/from-cordis.ts`
的适配桥）——那里做的就是「名字 → 令牌」的采纳，是这条规则的反面。

### 该用什么

| 场景 | 写法 |
| --- | --- |
| 本行需要某服务 | `inject(Token)`（字段初始化，填充期解析） |
| 可能没有 | `inject.optional(Token)` |
| 装配完成后才探测 | `app.get(Token)`（`bootstrapApplication` 的返回值，不是 `ctx.get`） |
| **按调用方的 ctx 读**（`systemPrompt.context()` 这类「scope 取自调用方」的上游语义） | `ctx.serviceOf(Token)`（框架面提供；内部走 `tokenMetaOf(Token).name`，**断言只活在那一处**） |
| 上游只按名字发布、我们没有令牌 | 先**补令牌**（在拥有该服务的域定义），让 `adoptNamedServices` 接上；补了令牌也只有**读法**变了，顺序仍靠行序（见「边界」里 `inject` 的两种顺序语义） |

### 判据

```sh
grep -rn '\.get("[a-zA-Z]\|reflect\.get(' packages --include='*.ts' --include='*.tsx' | grep -v __tests__ | grep -v 'zephyr/zephyr/src/\(bootstrap\|compat\)'
```

**期望输出为空**（框架层那两个文件例外）。


### `reflect.provide` 的例外（只有一种）

**上一节那条「装配期的 `reflect.provide` 是一等形态」要按这一条收窄**：它只适用于「**我们发 → 上游按名字读**」
的对接——即名字是**上游协议的拼法函数给出来的**（`storageBackendServiceKey(RDB_STORAGE_BACKEND)` 这种），
我们没有别的选择。

其余情况下「发布服务」都走令牌：清单里的 `{ provide: Token, useValue }`、`@Injectable()` 的 Provider 类、
或多值 `provide([...])`。

判据：`grep -rn 'reflect\.provide(' packages | grep -v '_test\|__tests__' | grep -v 'zephyr/zephyr/src/\\(bootstrap\\|compat\\)'`
——期望**只剩**那类「上游协议 key」的发布（当前 3 处，各带理由）。

### 依赖必须显式声明，杜绝动态

**没有「按任意 ctx 查服务」这条退路**——包括 `ctx.get(name)`、`ctx.reflect.get(name)`，以及任何把它们包一层的
`serviceOf(ctx, Token)` 之类。一条都不做。

依赖关系只有一种表达：**显式声明**
- 本行依赖：`inject(Token)` / `inject.optional(Token)`（字段初始化，填充期解析，缺提供者在装配阶段就报）；
- 清单条目：`{ provide: Token, useValue }`；
- scope 上的依赖：**和 agent scope 一样做额外声明**（`@AgentScoped()` 那种形态），不靠运行时按名字取。

**遇到「必须按调用方 ctx 读」的诉求时，先问三个问题**（三个都比 `serviceOf` 好）：
1. 这个依赖能不能**显式声明**？（多数情况可以，只是当初为了少写一行才走的动态）
2. 这个**双向依赖**能不能拆成单向？（注册表模式：后初始化的一方把钩子**注册到**先初始化的一方，而不是反过来读）
3. 上游那个「按调用方 ctx」的语义，能不能**换成我们声明的 scope 令牌**？

判据：
```sh
grep -rn 'serviceOf|\\.get("[a-zA-Z]|reflect\\.get(' packages --include='*.ts' --include='*.tsx' \
  | grep -v __tests__ | grep -v 'zephyr/zephyr/src/\\(bootstrap\\|compat\\)'
```
——**期望为空**（`scoped.get(` 属上游 session scope 的 API，不计；但要在调用点注明）。
