# zephyr 装配结构与命名

状态：已采纳
范围：凡是承载 zephyr 装配的包（能力包、bundle、聚合层）。zephyr 特有的要求都在这里，根规范只留与框架无关的通用约束。

## 规则

```text
src/<domain>/<type>.service.ts   @Injectable() Provider（一个文件一个类型）、fromCordisService() 令牌
src/<domain>.provide.ts          域装配函数：provide([...默认清单]) → 域外只调 provideXxx()
src/<domain>/index.ts            只导出本域的 provide / service
src/index.ts                     包门面：只具名导出（Provider / Config / 类型 / provideXxx）
<package>/src/cordis-register.ts   行入口：export default toCordis(Provider, { Config })
```

- **一个文件一个类型，按 domain 放目录**：每个 Provider 独占一个 `<type>.service.ts`，同域的
  `<domain>.provide.ts` 与 `index.ts` 放在同一目录；不把多个上游插件塞进同一个文件或目录（聚合层同样适用）。
- **契约与实现同目录、命名成对**：契约写 `<domain>/<x>.contract.ts`（`@Injectable() abstract class`），
  实现写同目录的 `<x>.service.ts`、类名 `<X>Default`；不另建 `contracts/` 目录，也不把实现塞进契约文件。
- **域装配函数是装配面**：`export const provideXxx = provide([configure(X, DEFAULTS), Y])`；装配面只写
  `providers: [provideXxx(...features)]`，不手写 provider 清单、不自己写 `reduce`。
  局部改 / 局部删是 feature：`configure(X, patch)`（按实现类深合并）、`without(X)`（剔除）。
- **不引入全局共享状态**：运行上下文只由配置构造（`AppEnv` 这类契约在装配入口显式给值），
  不在模块作用域存可变单例、不读进程级环境变量做隐式配置；同一进程里两份装配互不影响。
- **bundle 的装配真源是它的 provider 清单**：不加 `dsh.packages` / `dsh.specs` 元数据、不为旧调用方加
  re-export；清单里的条目决定 insert 行，`configure` / `without` 决定 config / disabled 行。
  （生成 `cordis.patch.yml` 的静态入口待定，见债务「codegen 没有静态入口了」。）
- **`index.ts` 只具名导出**：Provider、Config、类型与常量；不转出 default、不写实现。行入口在
  `<package>/src/cordis-register.ts`（`export default toCordis(Provider, { Config })`），`toCordis` 不列 `providers`
  ——依赖由 Provider 的字段注入解析。
- **令牌类型写真实类型**：服务（槽位值）用它的真实类型，不用 `any`；`InjectionToken` 只用于没有服务类型的
  纯配置对象；槽位令牌带 `host`（提供它的 client 插件包），构建期据此生成 `dsh.client.inject`。
- **纯工具 / 类型 / 常量不进 `*.service.ts`**：它们没有 zephyr 装配语义，按普通文件放。
- **声明式边界**：业务包只写 `@Injectable()` + 字段 `inject(...)` + `provide([...])` + `toCordis(...)`；
  `provideToken` / `resolveProvider` / `onService` / `attachProvider` / `ctx.get` 这类命令式读取只允许出现在
  框架与聚合层的适配代码里。单例与 adapter 的关系用 `provide([...])` 的清单 + 继承令牌表达，不在构造里手工 provide。
- **依赖声明式注入**：依赖写成字段 `inject(Token)` / `inject.optional(Token)`；不写 `static inject` 数组、
  不在运行期按 `ctx.get("名字")` 取服务；类型收窄用具体类型，禁用 `as never`。
- **可被 `inject` 的必须是契约**：`inject` 的目标只能是 `@Injectable() abstract class`；实现类 / 纯实现行 /
  上游内部服务名都不是注入目标。运行时判据在 `createInjectPlaceholder`：`getTokenMeta(token) !== undefined`，
  否则抛 `inject() 的目标必须是 @Injectable() 契约：<name>`。类型层没有可用的品牌——本仓的类型检查走
  `experimentalDecorators`（legacy），装饰器返回类型不会带回类类型上，因此「只接受契约」由运行时判据兜底。
  要读某个能力就先给它起契约，实现类只出现在 `provide([...])` 的清单里。
- **根名字视图只由我们的机制写**：`provideService`（令牌）与 `publishServiceName(契约名)` 是仅有的两个入口；
  上游插件 `ctx.provide(name, …)` 的名字只留在行内 `local`，不发布到根。**例外且必要的一条**：契约声明了
  `static serviceName` 时，`provideService` 的 `token.serviceName` 分支会把那个上游注册名一并写进根名字视图——
  上游按 `ctx.get('<name>')` 读可选能力（`typert` 这类）需要它。跨行要读的**其它**上游名仍须先定义契约。
- **装配名不手写（guideline）**：按上面的结构建包时，行 id 取 Provider token 名、包名取 Provider 定义文件
  向上找到的 `package.json`（`@Injectable()` 记录定义文件）、`dsh.client.inject` 取 client 入口
  `inject(Token)` 的 `host` 包。`exports` / `engines.dsh` / `dsh.client.inject` 都由构建写回，不手写映射表。

## 判据

- 文件里出现 `@Injectable()` / `fromCordisService()` → `<type>.service.ts`；`provide([...])` → `<domain>.provide.ts`。
- 一个文件里出现两个 Provider 类 → 拆；一个目录里混两个上游插件 → 拆。

## 生命周期与适配判据

由 `src/__tests__/lifecycle.spec.ts`（A 组）与 `src/compat/__tests__/adapter-matrix.spec.ts`（B 组）守护；
改动框架必须让这两份一直绿。

- **失败回滚**：任一 `onInit` 抛错 → 应用不返回，**已启动的 provider 逆序卸载**（不留半个应用）。
- **卸载幂等**：`dispose()` 调多次只清一次；顺序是「使用方 → 提供方」（`onDispose` 里依赖仍可读）。
- **装配顺序**：`providers` 按声明顺序（feature 依调用顺序叠加）；`attachProviders` 串行不并发。
- **异步 apply**：`mount` 必须等上游 `apply` 完成再收集 `published`；晚到的 `provide` 也算（否则消费方拿不到，报 `provided nothing`）。
- **类判定**：`class X extends Service { constructor() {} }`（只有构造函数）也按类装载——不能靠原型方法数判断，否则会被当函数插件调用（`Class constructor … cannot be invoked without 'new'`）。
- **契约面转发**：契约令牌指向**面对象**（上游实例 / 上游 `provide` 值的 Proxy），不是上手实例本身：白名单 =
  实例自身键 + 原型链成员 + 上游 `inject` deps，白名单外的键读 `undefined`；方法按实例绑定（`constructor` 除外，
  它留给 `instanceof` 与占位判定）。上游内部自己注册（`ctx.inject(['webServer'])`）走 `providerInstance`，
  所以需要观测/包装时包 `providerInstance`，不包 `this`。
- **重复装配**：同一 Provider 出现两处按幂等处理（`onInit` 只跑一次）。
- **隔离**：`providerContext` 是 `private` 且不在包出口；外部要行作用域用 `inject` + `mount(ctx, deps)` 表达，没有别的口子。
- **可选注入**：`inject.optional(X)` 只在「装配里根本没有 X」时给 `undefined`；有提供者但未就绪时与必填一样等。
