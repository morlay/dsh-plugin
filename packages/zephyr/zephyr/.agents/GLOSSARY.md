# zephyr 框架层

cordis 之上的强类型适配层：把「类 + 字段注入」翻译成 cordis 的服务注册与生命周期，向上游兼容 cordis 插件。
运行期语义全归 cordis；本层不认识任何领域概念。上下文边界见仓库根 [`.agents/GLOSSARY-MAP.md`](../../../../.agents/GLOSSARY-MAP.md)。

## 术语

### 令牌与注入

**Provider**：
`@Injectable()` 标记的类。既是装配条目，也是服务令牌：`inject(Token)` 与 `app.get(Token)` 都按它解析。
适配型 Provider 由 `fromCordis()` 生成。
_避免使用_：service（上游的字符串服务名）、组件

**Token**：
Provider 类本身。名字由类名连字符化得到（`SessionStore` → `session-store`），这个名字同时是 cordis 的服务名。
_避免使用_：服务名表、key

**InjectionToken**：
没有服务类型的纯值配置用的令牌（`new InjectionToken<T>("name")`）。名字就是 cordis 的服务名。

**契约**：
只声明面的 `@Injectable() abstract class`；实现类继承它，不另立令牌身份。

**多值令牌**：
声明处写 `@Injectable({ multi: true })` 的令牌：可以有多个实现，注入端只能 `inject.all`。

**注入形态**：
`inject`（必需）/ `inject.optional`（可缺）/ `inject.all`（多值）。形态与令牌不匹配在装配前就报错。

**别名**：
`@Injectable({ name: "sessionPersistence" })` 给的上游服务名：装配时除派生名外再发布一份，供上游按驼峰严格读。

**服务表**：
cordis 根 ctx 上的服务 store，是**唯一**的服务注册表。本包只额外维护一张「令牌 → 实例」的索引。

### 装配

**装配清单**：
`provide([...])` 的产物：一份 Provider 条目（类 / `{ provide }` / 值 / 工厂 / `toCordis` 产物）的静态列。
清单只收 DSL 形态，裸 cordis 插件会被拒绝。

**域装配函数**：
`export const provideXxx = provide([...])`：一个域的唯一装配面，装配方只写 `...provideXxx(...features)`。

**feature**：
`configure(实现类, patch)` 与 `without(实现类)` 的产物：对清单的变换，由**调用方**叠加。
`configure` 深合并（对象逐键、数组整体替换），`without` 剔除条目。

**装配内核**：
`bootstrapApplication`：实例化、回填注入、按依赖序激活每行、逆序卸载。它的产物是 `App`。

**App**：
装配结果：根 ctx 与 `get` / `tryGet` / `getAll` / `dispose`。诊断、观测这类能力都是插件，不挂在它上面。

**行**：
一条被激活的装配条目。行名是实现类名的连字符形式（`SessionStoreDefault` → `session-store-default`），
与令牌名（`session-store`）可以不同。

### 适配

**fromCordis**：
把上游 cordis 插件包成 Provider 的工厂（`fromCordis(契约, 上游)` / `fromCordis(上游)` / `fromCordis(契约)`）。
产物只做类型面桥接。

**适配行**：
`extends fromCordis(...)` 的行：它的契约值由上游插件发布，自己不注册服务。`onInit` 里必须 `mount`。

**mount**：
适配行装上游插件的动作（`mount(ctx, config?, deps?)`）。`deps` 只在读取时替换，不注册进 cordis。

**toCordis**：
把 Provider 转成 cordis 插件对象（`{ name, Config?, apply }`）的工厂，用于「按 cordis 行装配」的部署与测试。

**上游插件条目**：
清单里直接写的 `toCordis()` 产物（带 Provider 标记的插件对象）。

### 出口

**包根**（`@morlay/zephyr`）：
本包的`.`出口，是**全集**：令牌与注入、装配清单、装配内核、诊断与日志契约。**两端共用**——面按用途分
（`. ` / `./compat` / `./testing`），不按运行环境分；cordis 在浏览器里是合法运行期。
_避免使用_：宿主面 / 浏览器面（本包不按运行环境分面）

### 事件与诊断

**EventEmitter**：
事件的类型面：子类把事件名、参数表、返回值收进类里，七种分发模式与 cordis 一一对齐。
事件名就是 cordis 的事件名。

**事件宿主**：
声明事件字段的 Provider：`readonly flush$ = new SessionFlush()`，`$` 后缀表示「这是个事件」。

**Logger**：
cordis logger 的强类型契约：消费侧 `inject(Logger)`，不读 `ctx.logger`。

**Debugger**：
装配诊断契约：给出每行启动结果、服务名与令牌名的快照。默认实现由装配内核装入，可被清单替换。
