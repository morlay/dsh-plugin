# 一个域包的目录与写法

一个域的包内分四块，**按职能命名**，不出现 `.token` 这类实现词：

```
packages/agent/dsh-<domain>/
├── src/
│   ├── index.ts                  # 包根（root）：契约 + 默认实现；只有纯 root 包才出装配函数
│   ├── contract/                 # 契约面：端口（注册表 / 目录 / 执行器 / 本域需要的外部能力）
│   │   ├── index.ts
│   │   └── <name>.contract.ts    #   一个契约一个文件
│   ├── endpoint/                 # RPC API：端点名 + 请求/响应形状（两端共用，无实现）
│   │   ├── index.ts
│   │   └── <name>-<method>.ts
│   ├── server/                   # 宿主半：RPC 实现 + 同进程端口实现 + 本面的装配函数
│   │   ├── index.ts              #   导出 provideXxx（宿主面）+ 该面实现类
│   │   ├── endpoint/             #   契约（`../endpoint/`）的宿主实现
│   │   │   └── <name>-endpoint.ts
│   │   └── registry-<name>.ts
│   ├── ui/                       # 浏览器半：store + 位置 + 视图 + 调 RPC 的实现 + 本面的装配函数
│   │   ├── index.ts              #   导出 provideXxx（浏览器面）+ 该面实现类
│   │   ├── <name>.store.ts
│   │   ├── <name>.slot.ts
│   │   ├── <name>.view.tsx
│   │   └── __tests__/
│   ├── <name>.service.ts         # 默认实现（随包根导出）
│   ├── server/<domain>.provide.ts   # 宿主面装配函数：provideXxx = provide([...])
│   └── ui/<domain>.provide.ts       # 浏览器面装配函数：provideXxx = provide([...])
└── package.json                  # exports: "." · "./endpoint" · "./server" · "./ui"（不单开 ./contract）
```

## 五块的职责

| 目录 | 是什么 | 依赖谁 |
| --- | --- | --- |
| `src/index.ts` + `src/<name>.service.ts` | **包根（root）**：契约聚合 + 默认实现；**有 server/ui 面的包不在这里出装配函数** | 基础库、别的域的契约 |
| `src/contract/` | **进程内端口**：注册表 / 目录 / 执行器 / 本域需要的外部能力（**不发独立出口**，随包根导出；两端共用的值放 `endpoint/`） | 只依赖类型与 zephyr |
| `src/endpoint/` | **RPC API**：端点名 + 请求/响应形状，一端能调什么 | 只依赖类型 |
| `src/server/` | **宿主半**：`endpoint/` 里契约的宿主实现（注册到 wire）+ 同进程端口实现 + `provideXxx` | `root` + `contract` + `endpoint` + 框架 host 面 |
| `src/ui/` | **浏览器半**：store / 位置 / 视图 / 调 RPC 的端口实现 + `provideXxx` | `endpoint` + 框架 client 面（**不引包根**） |

- **client 不 import host**：浏览器半只能引 `endpoint` 与框架契约，绝不引 `*.service.ts`。
- **host 不 import client**：`exports` 把两边分开，host 的任何路径都不许触达 `ui`（React / `.css`
  会把 Node 的模块图带崩）。

## 四个入口 + 装配只装 ui 与 server

`exports` 固定**四条**面（`. / ./endpoint / ./server / ./ui`）——**不额外开 `./contract`**：两端共用的声明（含品牌铸造函数）归 `./endpoint`，进程内端口归包根。

| 入口 | 导出什么 | 谁从这里装配 |
| --- | --- | --- |
| `.`（root） | 契约、默认实现、纯 root 包的 `provideXxx` | 只有**纯 root 包**（没有 server/ui 面的，如 `dsh-shell` / `dsh-persistence`）才被装配面直接取 |
| `./endpoint` | RPC 契约 + 端点名 + **两端共用的值/类型**（品牌铸造函数这类） | 不装配；浏览器半要的共用声明从这里取 |
| `./server` | 宿主面实现 + `provideXxx` | 装配面（host） |
| `./ui` | 浏览器面实现 + `provideXxx` | 装配面（client） |

- **`server` 依赖 `root`**（实现行要用包根的实现类与契约），反向不许：root 不 import `server/`。
- **`ui` 不引包根**：浏览器半只引 `./endpoint` / `./ui` 与框架 client 面。包根聚合了 host 实现
  （`*.host.ts` / `*.service.ts`），一旦引进来就会把 node-only 运行时（`createRequire` 这类）拖进浏览器。
  ui 面需要的**值**（品牌铸造函数这类）放 `./endpoint`，不放包根、也不新开 `./contract`。
- **装配面只从 `./server` 与 `./ui` 取 `provideXxx`**；root 里出现装配函数就说明它该在某个面里。
- **每个面都必须有 `provideXxx`**：面内多行也要合成一个装配函数，装配面不手写该面的清单。

## 命名

- **文件名与它导出的类强相关**（kebab-case 类名 + 角色后缀）：`CommandRegistry` → `command-registry.contract.ts`
  / `command-registry.service.ts`；`CommandPaletteView` → `command-palette.view.tsx`；`CommandPaletteStore` →
  `command-palette.store.ts`；`ConversationInputOverlaySlot` → `conversation-input-overlay.slot.ts`。
- **一个文件一个主类**：`CommandCatalog` 与 `CommandRunner` 是两个端口，就两个文件。
- **类名就是它是什么**：`CommandRegistry`（可写注册表）、`CommandCatalog`（只读目录）、`CommandRunner`
  （执行器）、`CommandPaletteStore`（状态）。**不用复数**（`Commands` / `CommandEntries` 都不行）。

## 服务端口（跨模块的客户端服务）

浏览器半里跨模块共享的服务，用 `InjectionToken` 表示，**文件按职能命名**、类名按它是谁：

```ts
// src/ui/sidebar-right.contract.ts
/** 右侧面板的对外动作面。 */
export const SidebarRight = new InjectionToken<SidebarRightFace>("sidebarRight");
```

- 定义在**消费方**（依赖倒置），实现由提供方或组合层绑定。

## 引用：export 的面走包名，不用相对路径

- 包内跨**面**/跨目录引用一律走 `exports` 的包名子路径：`@morlay/dsh-command/endpoint`、
  `@morlay/dsh-command/ui`。**没有子出口就加一条**，不要图省事写 `../endpoint/index.ts`——出口是这一层的
  契约，绕过去之后它就成了摆设。
- **barrel（`index.ts`）内部**与**同目录内**的引用用相对路径：barrel 本身就是聚合点，用包名会自己引自己。
- **包内测试也走包名**（`@morlay/dsh-command/endpoint` 而不是 `../../endpoint/index.ts`）：测试是唯一会在
  每次 CI 跑的消费方，用包名引等于**让测试守住 `exports`**——出口写错、漏了一条、文件名改了，测试立刻红。
  测试里留相对路径，出口就成了摆设：没人验证它能不能解析。
- **出口按需开，没人用不开**：先看有谁要引。聚合面 `.` 已经导出契约与模块，再单开一条 `./contract`
  只是把同一份东西列两遍；等真有消费方要求「只引契约、不拖实现」时再加。
- 确实需要多条时按**面**切（`endpoint` / `ui`），不要只给一个包名——只给包名等于让所有人拿到聚合面，
  装配期会读到还没初始化的类。
- **默认实现随包根一起导出**：`index.ts` 里 `contract` + `XxxDefault` + `provideXxx` 三段都出，不要为
  实现单开 `./service`——`abstract class Xxx` + `XxxDefault` 是标准搭配，它本来就是模块的一部分。
  包内测试要走到真实现（否则只能拿假件，等于没闭环），从包根引即可。
- 装配层仍然只 `import { provideXxx }`（`providers: [provideXxx(...features)]`），不手写 provider 清单。
- **同进程的端口实现是包 API，不是测试辅助**：`RegistryCatalog`（直连 `CommandRegistry`）从**包根**导出，
  单机模式与集成测试都用它；不要放 `./testing`，也不要为它绕 wire（`RemoteHandlers.invoke(...)` 是跨进程
  的路径）。生产浏览器那一侧才是走 remote 的实现（`./ui`）。
  wire 注册层（`*Endpoint`）自己单独测一遍「端点注册 + 转发」，别混进同进程的链路里。

## RPC 端点用装饰器声明

`server/` 里不手写 `handlers.register("commands/list", …)` 这种字符串——组名与方法名只在
`@RemoteGroup` / `@Remote` 上出现一次，注册交给 `registerRemoteGroup`：

```ts
@RemoteGroup({ name: "commands" })
@Injectable()
export class CommandEndpoint implements OnInit {
  onInit(): void { registerRemoteGroup(this.handlers, this); }

  @RemoteMethod({ name: "list" })
  async list(request: CommandListRequest): Promise<CommandListValue> { … }
}
```

- 装饰器在 `@morlay/zephyr-app/remote`（host 半）：`RemoteGroup` / `RemoteMethod` / `registerRemoteGroup`；
  浏览器半要 `@Remote` 时从 `@morlay/zephyr-app/client/remote` 拿（`Remote` 这个名字归上游装载面契约）。
- 方法名声明在**契约**上；`remoteMethodsOf` 沿原型链收集，所以实现类直接注册即可。
- 请求形状走 `endpoint/` 里的 `*Request` / `*Value`，端点名与线上一致。

## 一个界面模块 = 服务 + 位置 + 视图

```ts
@Injectable()                                          // 服务：状态自己管，只 inject 契约
export class Commands implements OnInit { … }

@SlotProvider({ name: "conversation.input.overlay" })   // 位置：只声明类型
export abstract class ConversationInputOverlaySlot extends SlotViewBase {}

@SlotView()                                            // 视图：只写 render()
export class CommandPaletteView extends ConversationInputOverlaySlot {
  render() { return <PopupSelectView … />; }           // 组件复用上游，不重写界面
}
```

视图里没有 slot 字符串、没有 `slots.register`；注册由 `SlotViewBase.onInit` 完成。复杂贡献用 `@Slot({...})`
（`slotRoot` / `slotScope` / `slotRegistrations`）。

## 装配

### 数组顺序无语义：隐式依赖必须变成「装配期失败」或「注释钉死」

`provide([...])` 里 feature 的**调用顺序就是叠加顺序**，但上游行之间存在隐式依赖：

- **顺序型**：`ui-theme` 在 apply 期同步读 `ctx.configForms`，它必须先于自己启动——所以 `provideTheme()`
  由应用装配按序装（`apps/dsh-custom-next/src/client/index.ts` 里紧跟在 `SettingsHost` 之后，注释写明）。
- **可见性型**：上游别的行按**名字**读兄弟行的服务（`ctx.configForms`）——契约令牌不够，还得
  `exposeUpstreamName("configForms")` 把注册名发布到根名字视图（隔离规则的唯一例外，理由写在该方法上）。

**顺序型依赖的正确做法是「哨兵 inject」**，不是注释：

```ts
@Injectable()
class ClientChainRequiresTheme {
  private readonly theme = inject(Theme);   // 只为「装配期失败」存在，字段永不被读
}
```

漏装 `provideTheme()` 时装配期直接报
`✗ client-chain-requires-theme: service "theme" is not available`——错误直指**漏了哪个域装配函数**，
而不是下游的 `✗ layout: service "theme" is not available`。这条 spec 也会命中，所以「生产改了、spec 忘了改」
被框架接住。

**这类哨兵极易被当成死代码删掉**：它不导出、不被引用、字段永不被读。删它之前先看注释——
删掉之后同样的错误会退回到「只看到 `layout` 缺服务，不知道漏了哪个域装配函数」。


`apps/*` 只写 `providers: [...]`，顺序 = 数据面 → 壳 → 各域界面。新增模块 = 域 `client-module/index.ts`
加一行 + 组合层加一条，不改别处。

## 单元测试闭环

每个模块、每个 endpoint 契约都自带 spec，**局部跑通**，不需要起全局服务：

```ts
// bootstrapApplication({ providers: [Commands, FakeRemote, FakeSessions] })
// 断言接缝：注册到哪个位置（slots.entries(name)）、服务返回什么、视图渲染出什么
```

判据：这条 spec 单独跑就能证明这个模块是对的；跑不起来说明它还在偷偷依赖装配顺序或别的域。
