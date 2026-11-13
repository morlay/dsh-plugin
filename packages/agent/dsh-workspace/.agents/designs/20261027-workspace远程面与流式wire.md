# workspace 远程面与流式 wire（`dsh-workspace`）

状态：已实现——`workspace/follow` 的流式帧、命令的增量广播、客户端绑定与目录选择的行都是当前形态
范围：`remote.workspace` 这一组的 wire 形态与两端归属：宿主行注册哪些端点、增量从哪来、客户端怎么接、目录选择的行挂在哪
非目标：会话组的 wire（home 在 [`dsh-conversation`](../../../dsh-conversation/.agents/designs/20261109-对话域边界与交付物归属.md)）；框架层的 `Remote` / `$stream` 实现（home 在 `packages/zephyr/zephyr-app`）
关联：设计 20261029-深层模块审计（`WorkspaceRegistry` / `DirectoryPickerBackend` 两条接缝）· 根 [`ui-module.md`](../../../../../.agents/standards/ui-module.md)（面与出口）

## 一、决定

| #   | 议题                       | 决定                                                                                                | 一句话理由                                                                                                                                 |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 列表数据面                 | 本行只注册 `workspace/follow`（流），不注册 `workspace/list`                                        | baseline 之后还有 upsert / remove / order / archived / pinned 五种增量，unary 列表表达不了                                                 |
| 2   | 增量从哪来                 | 由**命令的返回值**折成帧广播（`WorkspaceBroadcaster`），不订阅上游 `domain/changed`                 | `StorageDomain` 与本行是两个兄弟作用域，cordis 事件不跨兄弟传播，订阅到的流只有 baseline                                                   |
| 3   | 命令逻辑复用谁             | 复用上游 `WorkspaceCommands`（只读 `ctx.workspaceRegistry`），不装上游 `WorkspaceController` 那一行 | 那一行构造里 `ctx.plugin(DirectoryPickerController)`，子插件注册在作用域里一律报错；目录选择由本仓显式装配                                 |
| 4   | `initializeDefault` 谁实现 | 本行实现（目录策略仍用上游 `defaultWorkspaceDirectory`，建不建由注册表判定）                        | 上游把它放在 `WorkspaceController` 上，理由同 #3                                                                                           |
| 5   | 客户端状态机               | 用上游 `ClientWorkspaceModel`，本仓只接流与转命令                                                   | 它已经处理「unary 回声与流帧的先后」「removed id 不复活」这类竞态，重写要连测试一起抄                                                      |
| 6   | 目录选择的行               | 只注册侧栏那个 `directory-flow` 洞，`pick` 用稳定引用 + 单飞 + 取消去抖                             | 上游 `ui-directory-picker-native` 的 `apply` 要把两个洞绑成一个事务，而 `conversation.hero` 的位置属于上游 `ui-conversation`（本装配没装） |

## 二、现状事实

- **宿主注册的端点**（`packages/agent/dsh-workspace/src/server/workspace-controller.host.ts`）：`workspace/follow` 走 `handlers.registerStream`；unary 十条——`create` / `rename` / `delete` / `insertBefore` / `insertSessionBefore` / `archiveSession` / `unarchiveSession` / `pinSession` / `unpinSession` / `initializeDefault`。unary 的结果统一包成 `RemoteResult`（上游 client 面按 `result.ok` 解），流式帧本身即业务值。
- **帧的判别式**（客户端按 `type` 分支）：`baseline` / `replace` / `upsert` / `remove` / `order` / `archived` / `pinned`（`packages/agent/dsh-workspace/src/ui/workspace-controller.service.ts`）。
- **客户端绑定**：`packages/agent/dsh-workspace/src/ui/workspace-remote.binding.ts` 逐组 `$mount` 上游 descriptor（`@deepseek-ai/dsh-api-workspace-controller/remote`）；控制器等 `remote.whenNamespace("workspace")` 再开流（`packages/zephyr/zephyr-app/src/client/remote/remote.service.ts` 的 `whenNamespace`）。
- **流式接缝**：`Remote.$stream` 用上游 `RemoteStream`（`{ name, open, ended }` 那套自定义载具），逐帧带 `generation`，换代时重发基线。
- **`pick` 的三层保护**（`packages/agent/dsh-workspace/src/ui/directory-picker-native-slots.ts`）：稳定的 `pick` 引用（上游 effect 依赖 `[open, pick]`，换新函数会反复触发）、`pending` 单飞、取消后 300ms 去抖（上游 owner 假定 native 只会「成功 / 取消」，失败会重开 flow）。
- **失败也是裸值协议**：`directoryPicker/pick` 成功回裸路径、取消回裸 `null`；native 不服务的动词（如 `directoryPicker/list`）**抛**结构化错误 `directory-picker/unavailable`（错误对象上带 `code`），不是 `{ ok: false }`。
- **准入不在本包**：`workspace/*` 的调用准入由装配面装的上游 remote-access 插件判定（`provideRemoteAccess()`，实现在 `packages/zephyr/zephyr-app/src/remote-access/remote-access.service.ts`，包装 `@deepseek-ai/dsh-api-remote-access`）；`WorkspaceControllerRow` 不接触它，也没有任何 `{ allows: true }` 这类常量。
- **工作区与会话的绑定**：`packages/agent/dsh-workspace/src/server/session-workspace.host.ts` 的 `attach` 调上游 `attachSession`（按会话 header 的 cwd 校验归属），成功后广播 `upsert`。
- **品牌铸造在契约面（本轮补）**：`@morlay/dsh-workspace/contract` 现在以**值**导出 `WorkspaceId` 工厂（本地一行纯 cast，`id as WorkspaceId`）。上游把工厂放在**宿主包根**上（`types` 子路径的文件头写明「Types only」），按值转出会给契约面收一条到宿主根的运行期边；扩展层只能用 contract / testing / endpoint 三个面，拿不到包根。品牌铸造没有领域逻辑（`@deepseek-ai/dsh-brand` 的约定：独立副本产出的值可互换），所以复制的是那一行 cast，类型仍来自上游 `types`（纯类型，零运行期代码）。同域没有第二个 branded id，故只补这一个。

- **界面契约的覆盖守卫走框架 client 出口**：`src/ui/workspace-controller.contract.ts` 的 `AssertCovered` / `AssertTrue` 从 `@morlay/zephyr-app/client` 取（纯类型），**不从** `@morlay/zephyr-app` 包根取——包根是宿主面（链到 node 侧）。DSL 则一律从 `@morlay/zephyr` **包根**取（两端共用：内核与 DSL 是同一份，没有浏览器专用第二说明符）；适配行工厂 `fromCordis` / `kFace` 走 `@morlay/zephyr/compat`。

## 三、模块边界与接口

| 模块                                | 拥有（职责与不变量）                                                            | 不拥有（明确排除）                                                             | 依赖方向                                                    | 接缝 / 适配器                                         |
| ----------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------- |
| 宿主行 `WorkspaceControllerRow`     | `workspace/*` 的 wire 注册、命令结果 → 增量帧的换算、`initializeDefault` 的语义 | 工作区状态机（在 `WorkspaceRegistry`）、会话内容、界面                         | `WorkspaceRegistry` + `WorkspaceBroadcaster` + 框架 host 面 | `RemoteHandlers`（显式路由表）                        |
| `WorkspaceBroadcaster`              | 活跃 follow 流的登记与帧派发                                                    | 帧的业务含义（由命令方给）                                                     | 被宿主行与 `SessionWorkspaceHost` 调用                      | 无契约（包内 2 个消费者）                             |
| 客户端 `WorkspaceControllerDefault` | 接流、把帧交给 `ClientWorkspaceModel`、把命令转过去                             | 状态合并与快照缓存（在上游 `ClientWorkspaceModel`）                            | `Remote` + 上游 client 模型                                 | `LiveWorkspaceRemote`（`src/ui/remote-workspace.ts`） |
| `WorkspaceRemoteBinding`            | 逐组 `$mount` 上游 descriptor                                                   | 帧的解释、命令的实现                                                           | 框架 client `Remote`                                        | 上游 descriptor                                       |
| `DirectoryPickerNativeSlots`        | 侧栏 `directory-flow` 洞的注册、`pick` 的稳定引用与单飞                         | 目录对话框（上游 `NativeDirectoryFlow`）、后端能力（`DirectoryPickerBackend`） | `Slots` + `UiWorkspace` 令牌                                | `NativeDirectoryFlow` 占用项                          |
| `SessionWorkspaceHost`              | 会话↔工作区的绑定（`resolve` + `attach`）                                       | 会话创建、header 组装、工作区列表                                              | `WorkspaceRegistry` + 会话域契约                            | 上游 `attachSession`                                  |

**接口**：宿主侧对外只有 wire（组名 `workspace` + 方法名 + `RemoteResult`）；客户端对外只有两条——`$mount` 该组、`whenNamespace("workspace")` 之后再开 `follow`。装配面拿到的是一条行加一条绑定，顺序是绑定先于控制器（控制器要读 `Remote` 上的组）。

**深度**：删掉宿主行，`follow` 的增量就要在每个装配点重写一遍（上游的 feed 在本装配里收不到事件）；删掉客户端控制器，`ClientWorkspaceModel` 的接流与命令转发要在每个页面重做。两者都有深度。

## 四、行为与边界

- **正常路径**：页面挂载 → `$mount` → `whenNamespace("workspace")` → `follow` 首帧 `baseline`（`registry.list()` + 归档/置顶集合）→ 渲染工作区行。
- **写命令**：`workspace/<command>` 落 registry 后，宿主行把返回值折成 `upsert` / `remove` / `order` / `archived` / `pinned` 广播给所有活跃 follow 流。
- **取消**：客户端 abort 自己的 `AbortController`（行 dispose 时），宿主侧 `follow` 随 signal 收尾；取消不发终帧。
- **失败**：会话归属失败（`attach` 抛）只留痕不抛，见[债务 建会话时 workspace 挂载失败不回滚 agent](../../../dsh-conversation/.agents/debts/20261030-建会话时-workspace-挂载失败不回滚-agent.md)。

## 五、验收判据

| #   | 判据（Done when）                                                         | 测试面（接缝）               | 证据（命令 / 用例名）                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `follow` 首帧是 registry 的 baseline，取消即收尾                          | `workspace/follow`（宿主行） | `packages/agent/dsh-workspace/src/__tests__/workspace-host.spec.ts`：「`workspace/follow` 的首帧是 registry 的 baseline」「取消信号让 follow 结束（读完 baseline 后 abort 即收尾）」                                                              |
| 2   | 命令落 registry，且活跃流收到增量                                         | 宿主行 + 广播                | 同文件：「`workspace/create` 落到 registry 上并回 `WorkspaceValue`」「create 之后，活跃的 follow 流收到 upsert 帧」                                                                                                                               |
| 3   | 客户端把 baseline 与增量合进 store、把命令转成 `RemoteResult`             | 客户端控制器（mock server）  | `packages/agent/dsh-workspace/src/ui/__tests__/workspaces-store.spec.ts`：「follow 的首帧 baseline 写进 store（items / phase）」「增量帧（upsert）合并进 store」「create 走 `remote.workspace.create`，并把 `RemoteResult` 解成 `WorkspaceView`」 |
| 4   | 会话按 `workspaceId` 或 `cwd` 归属，两者同给要拒绝                        | `SessionWorkspaceHost`       | `packages/agent/dsh-workspace/src/__tests__/session-workspace.spec.ts`：「`workspaceId`：cwd 取 workspace 的路径…」「`workspaceId` 与 cwd 同时给：拒绝（与上游同序）」                                                                            |
| 5   | `pick` 转发到 native capability，取消也是成功，非 native 动词抛结构化错误 | `DirectoryPickerBackend`     | `packages/agent/dsh-workspace/src/__tests__/directory-picker-host.spec.ts`（三条用例）                                                                                                                                                            |
| 6   | `src/ui` 不从框架**宿主**包根取东西（含纯类型）                           | 包出口 / 打包图（结构判据）  | `grep -rn 'from "@morlay/zephyr-app"' packages/agent/dsh-workspace/src/ui \| grep -v __tests__` 零命中；`just custom build` 绿                                                                                                                    |

## 六、取舍

- **自己写一份 workspace 状态机**：`ClientWorkspaceModel` 已处理 unary 回声与流帧的先后、removed id 不复活；抄一份就要连测试一起抄。
- **用上游 `WorkspaceController.follow`**：它的 feed 订阅 `domain/changed`，跨兄弟作用域收不到事件，流只会有 baseline（页面表现为「建了工作区，列表不出现」）。
- **装上游 `ui-directory-picker-native` 的 `apply`**：它要等 `conversation.hero` 的声明，那个位置属于本装配没装的上游行；等装了 `ui-conversation` 再换回上游 `apply`，本行整份删除。
- **在本行里塞 `remoteAccess: { allows: true }` 这类常量**：准入是框架行的事，写在业务行里等于把「谁允许访问」变成工作区域的决定。
- **为框架包引业务 namespace**：客户端绑定留在业务包的 `./ui` 出口，框架只提供 `Remote` 接缝。
- **`ignoreWorkspaceCycles` 之类让 `pnpm -r` 绕过环**：环的代价与出口记在债务里，不在这一份设计里决定。

## 七、不做与已知债

- 不实现 `workspace/list`：列表靠 `follow` 的 baseline。
- 债务 [建会话时 workspace 挂载失败不回滚 agent](../../../dsh-conversation/.agents/debts/20261030-建会话时-workspace-挂载失败不回滚-agent.md)。

## 八、开放问题

1. **`initializeDefault` 的归属**：本行自己实现是因为上游把它挂在会 `ctx.plugin(...)` 的那一行上；上游若把它挪进 `WorkspaceCommands`，这里应当删掉实现。
2. **`ui-conversation` 装上之后**：`DirectoryPickerNativeSlots` 整份删除、换回上游 `apply`——依赖「`conversation.hero` 的位置声明」这条前置，目前没有排期。
