# zephyr 的公开接口（cordis plugin 的 DSL）

状态：已实现——运行期语义全归 cordis，本包只加强类型约束与装配前 / 编译期的依赖检查。
范围：`packages/zephyr/zephyr/`（`@morlay/zephyr`）对能力包暴露的三面出口：`.`（门面，两端共用）、`./compat`（上游适配）、`./testing`（测试面）。
非目标：领域能力、dsh 的 loader / patch / bundle 装配、客户端构建与渲染、进程与命令的生命周期。
关联：[如何写](./../standards/how-to-write.md)、[如何验证](./../standards/how-to-verify.md)、[术语](./../GLOSSARY.md)、根 [ADR-插件与dsh运行时按同一版本线配套](../../../../../.agents/adrs/20260924-插件与dsh运行时按同一版本线配套.md)。

## 一、决定

| #   | 议题       | 决定                                                                                                     | 一句话理由                                            |
| --- | ---------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | 令牌       | 契约类就是令牌：`@Injectable()` 登记元数据，名字 = 类名连字符化；`InjectionToken` 只装没有服务类型的纯值 | cordis 的服务名由我们派生，不另维护一张名字表         |
| 2   | 注入       | 字段注入 `inject` / `inject.optional` / `inject.all`；返回类型带必需的 phantom 品牌                      | 依赖在声明处可见，编译期能收集                        |
| 3   | 装配顺序   | 按 `inject` 声明做拓扑排序，清单顺序只作同层基准                                                         | 适配行的契约面要到 `mount` 之后才有，顺序错了拿到空壳 |
| 4   | 装配清单   | `provide(list, defaults?)` 返回 feature 函数；`configure` / `without` 是调用方的 feature                 | 谁提供什么必须静态可读                                |
| 5   | 上游适配   | `fromCordis` 只做类型面桥接，deps 在**读取时**替换、不注册进 cordis                                      | 上游私有细节不进我们的服务表                          |
| 6   | 事件       | 事件是 `EventEmitter` 的子类，名字 / 参数表 / 返回值收在类里；七种分发语义全归 cordis                    | 事件名拼错、参数不符要在编译期报出来                  |
| 7   | 诊断与日志 | `Logger` / `Debugger` 是普通契约，默认条目由 `bootstrapApplication` 装入，可被清单替换                   | 一切皆插件，不往 `App` 上加方法                       |
| 8   | 依赖检查   | 编译期 `ProvidersCoverage`（`__missingProviders`）+ 装配前 `assertResolvable` 两半                       | 装配错要在任何 `onInit` 之前暴露                      |

## 二、现状事实

- **三个出口**：`.` → `packages/zephyr/zephyr/src/index.ts`；`./compat` → `src/compat/index.ts`；`./testing` → `src/testing/index.ts`。三者与 `tsdown.config.ts` 的 `entry` 同名（[规则](../../../../../.agents/standards/describing-facts.md#exports-与代码布局一一对应)）。
- **令牌表在模块里**：`src/token.ts` 用模块级 `Map`（`registered` / `byName`）。同一进程里存在两份 zephyr 就是两张表——`tokenMetaOf` 对未登记的类只按类名派生，`multi` / `alias` 丢失。
- **名字有两套**：服务名 = 契约类名连字符（`SessionStore` → `session-store`）；行名 = 实现类名连字符（`SessionStoreDefault` → `session-store-default`，见 `rowNameOf`）。`@Injectable({ name })` 额外给一个上游别名（`sessionPersistence`），装配时按别名再发布一份。
- **服务注册**在 `bootstrapApplication` 里直接用 `ctx.reflect.provide`（派生名 + 别名）；适配行不自己注册，它的契约面来自上游。
- **装配流水**（`src/bootstrap.ts`）：逐条实例化并登记 → `assertResolvable` 预检 → 拓扑排序 → 逐行 `ctx.plugin` 里跑 `onInit` → `bindFace` 换契约面 → `adoptNamedServices` 采纳上游按名发布的服务。
- **默认条目按缺省补**：清单里没有 `Logger` / `Debugger` 时，`bootstrapApplication` 追加 `{ provide, useValue }`（`ctx.logger` 本身与 `DebuggerDefault`）。
- **`timeoutMs` 只声明不消费**：`BootstrapOptions.timeoutMs` 在 `src/bootstrap.ts` 里没有任何读取点。

## 三、模块边界与接口

| 模块                                             | 拥有（职责与不变量）                                                                 | 不拥有（明确排除）                                                    | 依赖方向                 | 接缝 / 适配器                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------ | ------------------------------------------------ |
| 令牌与注入（`src/token.ts`）                     | 类即令牌、名字派生、上游别名、注入占位与形态标记                                     | 服务的注册与解析（cordis store）；令牌的领域语义                      | 无（不 import 任何域包） | 注入占位是编译期品牌，运行期由装配内核回填       |
| 装配清单（`src/provider.ts`）                    | 条目形态（类 / `{provide}` / 值 / 工厂 / `toCordis` 产物）、feature 变换、深合并规则 | 条目的**执行顺序**（归装配内核）；插件生命周期                        | ← 令牌                   | `configure` / `without` 是 feature               |
| 装配内核（`src/bootstrap.ts`）                   | 实例化、注入回填、拓扑排序、逐行 fiber、逆序卸载、诊断快照                           | cordis 的服务名表与 fiber 语义；上游 `apply` 内部；dsh loader / patch | ← cordis、令牌、清单     | `App`（`get` / `tryGet` / `getAll` / `dispose`） |
| 上游适配（`src/compat/from-cordis.ts`）          | 三种形态（契约+上游 / 只有上游 / 只有契约）、`mount`、deps 读取替换、配置三层合并    | 上游插件的生命周期语义（cordis fiber 管）；行 id（patch / 构建给）    | ← 令牌、`mountRow`       | 适配器 = 每条适配行                              |
| 行入口（`src/compat/to-cordis.ts`）              | 把 Provider 转成 `{ name, Config?, apply }` 插件对象                                 | 行配置的持久化与写回（dsh loader / settings）                         | ← `mountRow`             | 生产端接缝（dsh Loader）                         |
| 事件（`src/event-emitter.ts`）                   | 事件的类型面与七种分发调用                                                           | 事件名表、监听者顺序与派发时机（cordis events）                       | ← cordis ctx             | cordis 的事件总线就是接缝，本包不另造            |
| 诊断与日志（`src/debugger.ts`、`src/logger.ts`） | `DebugSnapshot` 形状、两个契约与默认实现                                             | 日志级别与落盘（CLI / cordis logger）；诊断的呈现                     | ← 令牌                   | 装配面可 `without(Debugger)` 或替换实现          |
| 编译期覆盖（`src/coverage.ts`）                  | `ProvidersCoverage`：从清单字面量收集必需令牌并比对                                  | 运行期校验（`assertResolvable` 在装配内核里）                         | ← 令牌、清单             | —                                                |

**接口**（调用方正确使用要知道的）：

```ts
// 令牌与注入
@Injectable(options?: { multi?: boolean; token?: Function; name?: string })
new InjectionToken<T>(name: string, options?: { multi?: boolean }): TokenClass<T>
inject<T>(token: TokenClass<T>): T & Required<T>
inject.optional<T>(token: TokenClass<T>): T | undefined
inject.all<T>(token: TokenClass<T>): T[]

// 清单
provide<const L>(list: L, defaults?: readonly ProviderFeature[]): (...features: ProviderFeature[]) => L
configure(impl, patch: DeepPartial<ConfigOf<Impl>>): ProviderFeature
without(impl): ProviderFeature

// 装配
bootstrapApplication<const L>({ providers: L, timeoutMs? } & ProvidersCoverage<L>): Promise<App>

// 适配与行入口（./compat）
fromCordis(contract, upstream) | fromCordis(upstream) | fromCordis(contract)
toCordis(provider, options?: { Config }): CordisPluginEntry
```

不变量：`inject` 的形态必须与令牌的 `multi` 一致（装配前校验）；`inject(Token)` 的必需性进入编译期检查，`optional` / `all` 不参与；`provide` 的返回类型保留清单字面量（feature 之后仍按原字面量算，属保守方向）。

**深度**：删掉本包，每个能力包都得自己写一遍「名字派生 + 注入回填 + 生命周期 + 形态校验 + 编译期收集」——复杂度不会消失，只在 N 个包重复出现。

## 四、行为与边界

- 正常：清单按**依赖序**逐行激活；`app.get(Token)` 按令牌元数据的 `token` 取实例，缺失即抛。
- 错误：必需依赖缺提供者 → 预检阶段抛（任何 `onInit` 之前，报「谁需要哪个令牌」）；清单里出现裸 cordis 插件 → 抛；适配行忘了 `mount` → `bindFace` 抛（与「上游本来就不发布服务」区分）。
- 生命周期：某行 `onInit` 抛错 → 应用不返回，已启动的行逆序卸载；`dispose()` 逆序跑 `onDispose`，此时依赖仍可读。
- 顺序：同层沿用清单顺序；**环依赖不报错**（保持原序），因为上游按名字读服务的那条边框架看不见。
- 并发：装配是串行的（逐行 `await` fiber）；`App` 本身不加锁，并发调用由各行的实现负责。
- 事件：作装配行时是一行普通 Provider；作宿主字段时由填充阶段对每个 `EventEmitter` 字段调 `onInit(ctx)` 接线，未接线就调用会抛「在装配完成前被使用」。

## 五、验收判据

| #   | 判据（Done when）                                                                        | 测试面（接缝）                  | 证据（命令 / 用例名）                                                                                         |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | 契约 + 实现 + 消费者：注入拿到同一实例，`app.get(契约)` 与注入同一个                     | `bootstrapApplication` + `App`  | `src/__tests__/assembly.spec.ts`「契约 + 实现 + 消费者：bootstrap 之后 inject 拿到同一个实例」                |
| 2   | 装配顺序由 `inject` 决定，清单顺序颠倒不影响                                             | 同上                            | `assembly.spec.ts`「装配按 `inject` 依赖排序：清单顺序颠倒也不影响」                                          |
| 3   | `inject.optional` 也参与依赖序（消费者不会拿到适配行空壳）                               | 同上                            | `src/__tests__/optional-inject-order.spec.ts`「消费者排在适配行之前时，它的可选注入也拿到上游面（不是空壳）」 |
| 4   | 缺必需依赖在**任何 onInit 之前**失败，且编译期就报（`@ts-expect-error`）                 | 同上                            | `assembly.spec.ts`「缺依赖：在任何 onInit 之前就失败，报出谁需要谁」                                          |
| 5   | 形态误用（`inject` 用在 multi、`inject.all` 用在单值）装配前报错                         | 同上                            | `assembly.spec.ts`「形态用错：…都在装配前报错」                                                               |
| 6   | `configure` 深合并（对象逐键、数组替换）、`without` 剔除                                 | `provide` 的 feature            | `assembly.spec.ts`「`configure` 深合并 config，`without` 剔除条目」「`configure` 对非对象 config 整体替换」   |
| 7   | 别名：派生名与 `@Injectable({ name })` 的别名读同一个实例；没写别名不凭空多发            | 装配内核的注册路径              | `assembly.spec.ts` 里「`@Injectable({ name })` 的别名」那一组用例                                             |
| 8   | 卸载逆序、`onDispose` 时依赖仍可读                                                       | `App.dispose`                   | `assembly.spec.ts`「`dispose`：onDispose 按装配的逆序执行」「`onDispose` 执行时依赖仍可读」                   |
| 9   | 事件参数表逐事件独立、退订生效、未装配即报错、参数不符编译不过                           | `EventEmitter`                  | `src/__tests__/event-emitter.spec.ts`（5 条用例）                                                             |
| 10  | 适配行：契约面来自上游、deps 只替换读取、`Service` 子类要 `new`、忘 `mount` 装配期报错   | `fromCordis` / `mount`          | `src/compat/__tests__/from-cordis.spec.ts`（各条 `it`，含「适配行忘了 mount：装配期就报错」）                 |
| 11  | `toCordis` 产物能被 dsh 行装载：`Config` 默认值生效、`onInit` 被调用、卸载跑 `onDispose` | `toCordis`                      | `src/compat/__tests__/to-cordis.spec.ts`（3 条用例）                                                          |
| 12  | 上游按名字发布的服务能按同名令牌取到                                                     | 装配内核的 `adoptNamedServices` | `assembly.spec.ts`「上游按名字发布的服务能按同名令牌取到（没有对应的行）」                                    |

命令：`pnpm exec vitest run packages/zephyr/zephyr`（从仓库根）。

## 六、取舍

- 不维护第二套服务名表：cordis store 是唯一注册表，本包只多一张「令牌 → 实例」的索引。
- 不造 ctx 代理：`onInit(ctx)` 拿到的就是 cordis 子 ctx。
- 不做运行期反射发现提供关系：提供关系由清单静态决定。
- 不做全量类型推导：`provide` 保留清单字面量，`without` 剔掉的条目在类型层仍算「提供过」——保守方向（漏报不误报）。
- 不写 `static inject` 数组：依赖只在字段上，注入形态可被校验。
- 事件不用「字符串 + 模块增强」：名字与参数表收进类，编译期可查。

## 七、不做与已知债

- 不解析 dsh 的 patch / loader 行、不做 profile 种子、不碰客户端构建。
- 环依赖静默按原序装配（见第四节的「顺序」），没有告警——这是有意的：框架看不到上游按名读的边，误报比漏报更贵。

## 八、开放问题

- `BootstrapOptions.timeoutMs` 在代码里只声明不消费：调用方（`zephyr-cli` 的 dev / preview / run）都在传值。要么实现超时，要么删掉这个字段。
- 事件的两种形态都在用（进清单当行 / 当宿主字段），是否收敛成一种，未定。
