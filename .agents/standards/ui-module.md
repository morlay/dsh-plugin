# 界面模块（浏览器半）

一个界面模块 = **服务 + 位置 + 视图**，装配面只收一个 `provideXxx()`。浏览器半与宿主半靠 endpoint 面的
wire 契约对齐，两边互不 import。文件布局与面的总规则见
[`how-to-write.md`](../../packages/zephyr/zephyr/.agents/standards/how-to-write.md)，
这里只写浏览器半。

## 判据一览

| 判据         | 命令                                                                              |
| ------------ | --------------------------------------------------------------------------------- |
| 面边界       | `just audit`：`ui→host` 与 `server→ui` 为零（[如何写](./how-to-write.md)）        |
| 装配装得起来 | `pnpm exec vitest run packages/<family>/<pkg>/src/ui`；组装用 `just custom build` |
| 出口解析得到 | 包内 ui 面的 `__tests__` 按**包名**引自己的面                                     |
| 类型与规则   | `just lint`                                                                       |

## 目录与文件

ui 面（`packages/<family>/<pkg>/src/ui/`）按职能分文件，一个文件一个主类型：

| 文件后缀              | 是什么                                                      | 例（[`dsh-command`](../../packages/agent/dsh-command/src/ui)） |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `<name>.contract.ts`  | 跨行服务的契约（`@Injectable() abstract class` 或纯值令牌） | `command-ui.contract.ts`                                       |
| `<name>.service.ts`   | 有实现的跨行服务                                            | `command-ui.service.ts`                                        |
| `<name>.store.ts`     | 状态：自己管，只 `inject` 契约                              | `command-palette.store.ts`                                     |
| `<name>.slot.ts`      | 位置：只声明类型（`@SlotProvider({ name })`）               | `conversation-input-overlay.slot.ts`                           |
| `<name>.view.tsx`     | 视图：只写 `render()`，组件从 `@morlay/zephyr-ui` 取        | `command-palette.view.tsx`                                     |
| `<domain>.provide.ts` | 本面的装配函数：`export const provideXxx = provide([...])`  | `command.provide.ts`                                           |

- **命名与导出的类强相关**：`CommandPaletteStore` → `command-palette.store.ts`；类名不用复数。
- **`ui` 不引包根**：包根聚合了宿主实现，引进来会把 node-only 运行时拖进浏览器；要的值放 endpoint 面。
  判据：`just audit` 的 `ui→host`。

## 令牌

| 令牌                                  | 什么时候用                                                        | 判据                                                                 |
| ------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| 契约类 `@Injectable() abstract class` | 有实现类、由清单里的行提供                                        | `inject(Token)` 拿实例；契约住 contract 面或 ui 面的 `*.contract.ts` |
| `InjectionToken<T>`                   | 没有实现类、由**上游行**在 mount 期按名字发布（如 `uiWorkspace`） | 声明时写真实类型；拿不到类型是债，不写成 `unknown` 就算完            |

- **依赖只经 `inject`**：`inject(Token)` / `inject.optional()` / `inject.all()`；不写字符串
  `ctx.get("名字")`、不 `new` 一个令牌就地取服务。
- **浏览器半不 `new` 上游服务**：上游建在行内部的实例（`new UiWorkspaceService(ctx, …)`）只能由那一行
  发布成令牌，别处按令牌注入（[`ui-workspace.token.ts`](../../packages/agent/dsh-workspace/src/ui/ui-workspace.token.ts)）。

## RPC 端点：名字只在契约上出现

宿主半（server 面）里不手写 `handlers.register("commands/list", …)` 这种字符串：组名与方法名只在
`@RemoteGroup` / `@Remote` 上出现一次，注册交给 `registerRemoteGroup`。

```ts
// endpoint：契约（两端共用，无实现）
@RemoteGroup({ name: "commands" })
export abstract class CommandEndpoint {
  @RemoteMethod({ name: "list" })
  abstract list(request: CommandListRequest): Promise<CommandListValue>;
}

// server：实现 + 注册
@RemoteGroup()
export class CommandEndpointDefault extends CommandEndpoint {
  @RemoteMethod()
  async list(request: CommandListRequest): Promise<CommandListValue> { … }
  onInit(): void { registerRemoteGroup(this.handlers, this); }
}
```

- **导入路径**：宿主半 `@morlay/zephyr-app/remote` 拿 `RemoteGroup` / `RemoteMethod`（`Remote` 的别名）
  与 `registerRemoteGroup`；浏览器半要 `@Remote` 时从 `@morlay/zephyr-app/client/remote` 拿——`Remote`
  这个名字归上游装载面契约。
- **契约写名字、实现不写**：`remoteGroupNameOf` / `remoteMethodsOf` 沿原型链取（
  [`decorators.ts`](../../packages/zephyr/zephyr-app/src/remote/decorators.ts)）。
- **流式方法标 `{ mode: "stream" }`**：注册走 `registerStream`；方法签名按实参个数分派
  （`follow(request, signal)` 与 `control(signal)` 两种），别一律塞 `(request, signal)`。
- **请求形状住 endpoint 面**：`*Request` / `*Value` 与线上一致；上游按位置传标量时用
  `parameters: ["sessionId"]` 声明 wire 名。
- 判据：端点 spec 里 `handlers.invoke("<组>/<方法>")` 的入参与返回值。

## 位置与视图

```ts
@SlotProvider({ name: "conversation.input.overlay" })        // 位置：只声明类型
export abstract class ConversationInputOverlaySlot extends SlotViewBase {}

@SlotView()                                                   // 视图：只写 render()
export class CommandPaletteView extends ConversationInputOverlaySlot {
  render() { return <PopupSelectView … />; }
}
```

- **视图里没有 slot 字符串、没有 `slots.register`**：注册由 `SlotViewBase.onInit` 完成，位置由
  `extends` 的类型决定（[`slot-view.tsx`](../../packages/zephyr/zephyr-app/src/client/renderer/slot-view.tsx)）。
- **子位置用位置类声明**：`protected readonly seats = [SomeSlot]`，渲染用 `this.child(SomeSlot)`；
  名字由位置类自己的 `@SlotProvider` 决定，视图不写名字。
- **要带 `locale` / `priority` / `children` 的贡献用 `@Slot({...})` + `slotRegistrations()`**
  （[`slot.decorator.ts`](../../packages/zephyr/zephyr-app/src/client/renderer/slot.decorator.ts)），
  那是 `@SlotView` 的加强形态，不是另一套机制。
- **视图只组合、不写样式**：控件与样式从 `@morlay/zephyr-ui` 取；业务包不定义 `*.module.css`、
  不写 inline `style`（判据在该包规范）。

## 装配

- **每个面一个 `provideXxx`**：面内多行也合成一个，装配面只写 `...provideXxx()`；跨面不合并
  （server 面进 Node、ui 面进浏览器）。
- **剔行用 `without(实现类)`，改配置用 `configure`**：`without` 一次只剔一个实现类；配置对象逐键合并。
- **顺序是硬要求，用「哨兵」而不是注释钉住**：`ui-theme` 在 `apply` 期同步读 `ctx.configForms`，
  `ui-layout` 同步读 `ctx.theme`，所以装配面必须写成「真 `configForms` → 链 → `provideTheme()` →
  `provideLayout()`」（[zephyr-app 的 README](../../packages/zephyr/zephyr-app/README.md) 的「装配顺序」）。
  漏装 `provideTheme()` 时，`ClientChainRequiresTheme` 让错误报在链自己身上
  （[`provide.ts`](../../packages/zephyr/zephyr-app/src/client/provide.ts)）。
- **这个哨兵不是死代码**：它不导出、字段永不被读，删掉之后同样的错误会退回到
  「`layout` 缺 `theme`，不知道漏了哪个装配函数」。
- **`apps/*` 只写清单**：`appClientProviders()` 里数组顺序即激活顺序，改动要在注释写明依赖理由
  （[`client.provide.ts`](../../apps/zephyr-custom/src/client/client.provide.ts)）。

## 出口

- **按面开、按需开**：ui 面给装配面，endpoint 面给两端的 wire 形状，contract 面只给要「契约不拖实现」的
  消费方（如 `agent-ex`），testing 面给下游测试。没有消费方的面不开。
- **面内跨目录引用走包名**：`@morlay/dsh-command/ui`，不写指向别的面的相对路径；barrel（`index.ts`）
  内部与同目录内才用相对路径。**包内测试也走包名**——它顺带守住 `exports`。

## 测试

- **落点**：ui 面各目录下的 `__tests__/*.spec.tsx`，文件头 `// @vitest-environment happy-dom`，`afterEach(cleanup)`。
- **判据是「这条 spec 单独跑就能证明这个模块是对的」**：`bootstrapApplication` + 本包的 `provideXxx()` +
  最小替身（`ConfigFormsInMemory`、`LocalRemote` 这类框架替身，或本包自己的 fake），断言注册到哪个位置
  （`slots.entries(name)`）、服务返回什么、视图渲染出什么。
- **跑不起来说明它还在偷偷依赖装配顺序或别的域**：补齐该域 testing 面的最小清单，而不是在 spec 里手摆
  别人的行。
