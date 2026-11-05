# dsh-session-api 四个 spec 的装配面与三条端点行为

状态：未销账（`session-endpoints` 3 条 / `session-references` 3 条 / `main-flow` 1 条 / `api-session-host` 1 条 = 8 条）

**现象**

四个 spec 自己手写 provider 清单（不装 `customProvidersOf`），本轮把它们从「装配期就炸」推进到
「装配成功、断言红」：

- `session-endpoints.spec.ts`：`session/list` 不回 `{ items: [...] }`；`session/modelCatalog` 回 `undefined`；
  「宿主重启后对已有会话 `prompt`」回 `session/not-found`。
- `session-references.spec.ts`：`fileReferences/list` 候选恒空；重启后 `meta.json` ENOENT；
  `sessionReferenceResolver/candidates` 建会话时撞 `context:file-reference`（同
  `20261104-建会话时-prompt-段落撞名`）。
- `main-flow.spec.ts`：`cannot get property "remoteAccess" without inject`——上游某行按
  `ctx.remoteAccess`（驼峰名）读，而我们只提供了令牌名 `remote-access` 的那份替身。
- `api-session-host.spec.ts`：假 `RemoteAccess` 与 typert binding 不一致（`gateway/binding-invalid`）。

**本轮已修（不是债，记在这里省下一个人的检索）**

- `provideAuth()` 必须排在 `provideConnection()` 之前（`credentials.modifyRecord`）。
- `provideCommand()` 必须排在 `provideUpload()` 之前（`ctx.commands.registerFileReceiptResolver`）。
- `provideStorage()` → `providePersistence(...)` → `SessionPersistenceDefault` 必须都在
  `provideWorkspace()` 之前（工作区注册表 init 里就 `open` domain、`listStoredHeaders()`）。
- `provideAgent()` 必须在 `provideWorkingDirectory()` / `provideSkill()` 之前
  （`ctx.systemPrompt.getContextOrder` / `ctx.tools.register`）。
- `SessionWorkspaceHost` 不能与 `provideWorkspace()` 并列（同名服务重复注册）。
- `provideSessionQuerySqlite()` 不能与 `provideSessionRemote()` 并列（后者已含它）。
- 沙箱整域用 `...provideSandbox()` 装（`FileSystem` 的实现 `FsSandbox` 在里面，`working-directory` 要它），
  它的前面还要有 `...provideShell()`（子进程 seam）。

**影响**

这 23 条红让 `just test` 无法全绿；它们也是「端点面到底通不通」的唯一覆盖。

**触发条件**

改动 `dsh-session-api` 的端点行、或改动上述任一被依赖域的装配面时。

**销账条件**

Done when：`pnpm exec vitest run packages/agent/dsh-session-api` 全绿（skip 除外）。

**不修的理由**

剩下三条是**行为**问题而不是顺序问题：`session/list` 的 wire 形状与 `session/modelCatalog` 的空结果都指向
「上游端点的 descriptor 没被我们这层 discovery 认出来」，要对着 `TypertGateway.resolveDescriptor` 与
`api-session.provide.ts` 的注册表逐条比；`restart → prompt` 那条还要先把 `session/create` 的持久化路径
跑通（与 `20261104-建会话时-prompt-段落撞名` 相邻）。本轮收口优先保证 `apps` 与其余 126 个文件，故留债。
