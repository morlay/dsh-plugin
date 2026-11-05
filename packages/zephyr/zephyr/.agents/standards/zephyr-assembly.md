# zephyr 装配：怎么写

范围：写能力包的人。框架内部的实现判据不在这里——那些由 `src/__tests__/lifecycle.spec.ts` 与
`src/compat/__tests__/adapter-matrix.spec.ts` 守护。接口定义见
[`../designs/20261104-zephyr-是-cordis-plugin-的语法糖.md`](../designs/20261104-zephyr-是-cordis-plugin-的语法糖.md)。

## 文件布局

```text
src/<domain>/<x>.contract.ts     契约：@Injectable() abstract class
src/<domain>/<x>.service.ts      实现：<X>Default（一个文件一个类型）
src/<domain>.provide.ts          域装配函数：provide([...默认清单]) → 域外只调 provideXxx()
src/<domain>/index.ts            只导出本域的 provide / service
src/index.ts                     包门面：只具名导出（Provider / Config / 类型 / provideXxx）
src/cordis-register.ts           行入口：export default toCordis(Provider, { Config })
```

- **一个文件一个类型**：每个 Provider 独占一个 `<x>.service.ts`；不把多个上游插件塞进同一个文件或目录。
- **契约与实现同目录、命名成对**：契约 `<domain>/<x>.contract.ts`，实现同目录 `<x>.service.ts`、类名 `<X>Default`；
  不另建 `contracts/` 目录。
- **纯工具 / 类型 / 常量不进 `*.service.ts`**：它们没有装配语义，按普通文件放。

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

export default toCordis(SessionStoreDefault, { Config });
```

- 依赖写成**字段注入**：`inject(Token)` / `inject.optional(Token)` / `inject.all(Token)`；
  不写 `static inject` 数组，不按 `ctx.get("名字")` 取服务。
- 只注入**契约**（`@Injectable() abstract class`）；实现类只出现在 `provide([...])` 的清单里。
- 生命周期承诺：`onInit` 抛错 → 应用不启动，已启动的 Provider 逆序卸载；`dispose()` 幂等，
  `onDispose` 执行时依赖仍可读。
- `inject.optional(X)` 只在「装配里根本没有 X」时给 `undefined`；有提供者但未就绪与必填一样等。

## 装配

```ts
export const provideSession = provide([
  SessionStoreDefault,
  { provide: SessionQueryDefault, config: { retentionDays: 30 } },
]);

// 装配面只写这一句；configure / without 是调用方的 feature
bootstrapApplication({ providers: [...provideSession(without(SessionHookDefault)), FooBar] });
```

- 域装配函数是唯一装配面：`export const provideXxx = provide([...])`；外部只调 `provideXxx(...features)`，
  不手写 provider 清单、不自己写 `reduce`。
- `configure(实现类, patch)` 按实现类定位条目、把 patch 与该条目 config 深合并（对象逐键、数组整体替换）；
  `without(实现类)` 剔除条目。两者都是**调用方**的 feature，不写进清单。
- **清单只收 DSL 形态**（Provider 类 / `{ provide }` 条目 / `toCordis()` 产物）：裸 cordis 插件或 feature
  混写都会被拒绝——绕过 DSL 自己拼装配，依赖与生命周期就不在静态检查范围内了。
- 装配顺序 = 清单声明顺序；feature 按调用顺序叠加。

## 命名与导出

- **行 id 从 token 派生**：Provider 类名连字符化就是行 id 与服务名，不写行元数据。
- **包名从 `package.json` 读**：`@Injectable()` 记录定义文件，向上找到所属包。
- **装配名不手写**：`exports` / `engines.dsh` / `dsh.client.inject` 由构建写回，不手写映射表。
- **`index.ts` 只具名导出**：Provider、Config、类型与常量；不转出 default、不写实现。

## 令牌

- **服务令牌写真实类型**：服务（槽位值）直接用契约类；`InjectionToken` 只用于没有服务类型的纯配置值。
- **多值令牌在声明处定**：`@Injectable({ multi: true })`，注入端用 `inject.all(Token)`。
- 槽位令牌带 `host`（提供它的 client 插件包），构建期据此生成 `dsh.client.inject`。

## 事件

- **事件是一个类，不是字符串**：`class SessionFlush extends EventEmitter<[SessionId]>`，
  构造函数里 `super("session/flush")` 给 cordis 的事件名。拼错事件名、少传/多传参数、回调签名不符
  都在编译期报出来。
- **参数表写在泛型里**：`EventEmitter<[SessionId, boolean]>` 是这个事件的**参数表**，不是单个 payload；
  无参事件不写泛型。返回值用第二个泛型：`EventEmitter<[Request], Decision>`。
- **事件声明在宿主 Provider 上，`$` 后缀**：

  ```ts
  class PolicyDefault extends Policy {
    readonly flush$ = new SessionFlush();

    onInit(): void {
      this.flush$.on((sessionId) => …);
    }
  }
  ```

  框架在填充注入后对每个 `EventEmitter` 字段调 `onInit(ctx)`，字段式声明不需要额外接线。
- **事件类不标 `@Injectable()`**：它是字段值，不是 Provider。
- **发布与订阅用同一份声明**：事件名就是 cordis 的事件名，所以订阅我们的 `Events.SessionFlush`
  与上游 `ctx.emit("session/flush")` 是同一个事件。
- **瀑布用 `onWaterfall`**：`tools/execute` 这类 `@mode waterfall` 的事件，监听者比 `on` 多一个 `next`，
  用错方法编不过。
- **事件类放包的 `events.ts`，出口挂命名空间**：`export * as Events from "./events.ts"`。

## 边界

- **不引入全局共享状态**：运行上下文只由配置构造（`AppEnv` 这类契约在装配入口显式给值）；
  不在模块作用域存可变单例、不读进程级环境变量做隐式配置。
- **声明式边界**：业务包只写 `@Injectable()` + 字段注入 + `provide([...])` + `toCordis(...)`；
  命令式读取（`resolveProvider` / `ctx.get` / 手工 provide）只允许出现在框架与聚合层的适配代码里。
- **运行期语义全归 cordis**：服务注册、作用域、生命周期都由 cordis 承担；服务的名字就是 token 名的连字符形式，
  `ctx.provide(name, …)` / `ctx.get(name)` 与 `inject(Token)` 指向同一个条目。
- **装配错在启动前暴露**：注入的令牌没有提供者时，装配阶段就失败并报出「谁需要谁、缺哪个」，不等到运行期。
