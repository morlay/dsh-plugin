# zephyr 框架层

本层是 cordis 之上的类型安全适配层：向上游兼容 cordis 插件，向下把 Provider 转成 dsh 行。它只服务本仓库的插件与 bundle，不含业务能力。边界登记在仓库根 [`.agents/GLOSSARY-MAP.md`](../../../../.agents/GLOSSARY-MAP.md)。

## 术语

### 装配

**Provider**：
`@Injectable()` 标记的类。既是装配条目，也是服务令牌；`inject(Token)` / `app.get(Token)` 都按它解析。适配型 Provider 由 `fromCordis()` 生成，不注册自己的实例，只把上游插件提供的服务接管进服务表。我们自己的能力包写自有 Provider（构造参数收行 Config，`onInit(ctx)` 挂行为）。
_避免使用_：service（上游的字符串服务名）、组件

**Token**：
Provider 类本身。跨包消费时用共享的服务类当令牌；令牌名由类名 hyphenate 得到，也是 dsh 行 id 的来源。
_避免使用_：服务名、key

**InjectionToken**：
没有服务类型的纯配置值用的令牌（`new InjectionToken<T>("name")`）。令牌名就是宿主 ctx 的服务名；带 `host` 时（`{ host: "<client 插件包>" }`）由构建期据此生成 `dsh.client.inject`。有真实服务类型的槽位不用它，直接写真实类型。

**上游服务适配令牌**：
`fromCordisService(ServiceClass, resolver?)` 返回的强类型令牌，代表已由 dsh 行装载的上游 Cordis 服务。`attachProvider` 在行 ctx 的服务表里按 `instanceof` 扫描它；给了 `resolver` 时按 resolver 从 ctx 取，消费侧写 `inject(令牌)`，不手写字符串服务名。

**官方行适配**：
`@Injectable() class Web extends fromCordis(WebRuntime)` 这类包装：带 `adapted` 与 `providerName`（上游插件名），行 id 由它派生；只覆盖 config、不生成 insert（行本身由上游 patch 提供）。

**providerContext**：
给仍按名字读 `ctx.<service>` 的上游 Service 类用的 ctx 代理：名字视图 + 原生 provide；不要求行 fiber 手写 inject。

**Context**：
Provider `onInit` 能看到的精简 Context 面，当前只有 `effect`；完整 cordis `Context` 只在适配层内部用，需要时经 `providerContext(ctx)` 取。

**Logger**：
`inject(Logger)` 的强类型令牌；Provider 不读 `ctx.logger`，日志依赖显式。

**configuredProvider / withConfig**：
`withConfig(config)` 返回的绑定配置 Provider 子类：`providerConfig` 在子类上，令牌仍是基类；容器负责 `new`。`configuredProvider` 是它的底层形式（可带 `resolve`）。

**FactoryProvider**：
`{ provide, useFactory(ctx) }`：由行 ctx 现算一个值挂到令牌上，用于「值来自别的服务」的纯映射（如 `InjectionToken` 的读取器）。

**without**：
Provider 列表里的剔除标记。`without(entry)` 运行期不注册、patch 里落 disabled 行；`without(entry, expr)` 运行期保留、patch 里把 `expr` 序列化成 `disabled`。

**服务表**：
根 ctx 共享的 token / name / multi 三张映射。Cordis 根 ctx 是唯一容器；同一棵 ctx 树里的所有 dsh 行注册进同一张表，行卸载只注销自己注册的服务。
_避免使用_：容器行、App 容器

**toCordis**：
把 Provider 转成 dsh 的 cordis 插件行（`name` / `Config` / `apply`）。行入口的 default export 用它；行 id 由 patch 声明，不由它决定；不再写字符串 `inject` 数组，依赖由 Provider 的字段注入解析。
_避免使用_：插件生成器（它只做运行期转换）

**上游插件条目**：
`providers` 里直接写上游 cordis 插件对象（`{ name, apply }` 或 `{ default }`）；行运行时等它声明的 `inject` 名字就绪后装载，`provide` 落名字视图与根 ctx，卸载时跑插件返回的 disposer。我们自己的能力包不写对象插件，直接写 `@Injectable()` class Provider。
_避免使用_：nativePlugin（已删除）

### dsh 装配

**dsh 行**：
profile patch 里的一条 Loader entry。行 id 是设置页 namespace、配置写回与 locale 的键；本仓库约定行 id = Provider 的 token 名。
_避免使用_：插件实例、entry（上游术语，指 Loader 的那条记录时可用）

**能力包**：
发布实现与显式 Config 的包（`packages/<family>/<pkg>`）。它的 dsh 入口是 `cordis-register.ts` 里的 `toCordis()` 薄壳，`index.ts` 只做具名导出。

**行名推导**：
构建期不手写行名：行 id 取 token 名；能力包的包名取 Provider 定义文件（`@Injectable()` 记录）向上找到的 `package.json`；官方行的包名由上游 patch（`patchPackagesOf`）给出。

**bundle Module**：
bundle 的源码真源，`@Module({ imports, providers })`。构建期只从它生成 `cordis.patch.yml`，不生成 bundle 的 `index.ts`；bundle 不被 profile 当行装载。
_避免使用_：bundle 入口
