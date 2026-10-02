# 如何验证（编排接缝）

通用规则（证据矩阵、jsdom pragma、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的接缝、装配辅助与未覆盖清单。

## 接缝与守护 spec（`src/__tests__/`）

- **编排（host）**：`ctx.sessionEditor` 的 `edit` / `retry` / `reroll` / `recall` / `rewind` / `fork`——
  动作的编排语义与重放范围：`{edit,retry,recall,branch,replay,plan}.spec.ts`。
- **传输（webServer）**：`POST /session-editor` 的行为——rewind 前先停运行中的 loop、动作分发与参数校验
  （非 POST → 405、非法 body → 400、操作被拒 → 409）：`http.spec.ts`。
- **传输（注册面）**：只注册一条 exact `/session-editor`（没有 `/api` 前缀的重复注册）：`http-connection.spec.ts`。
- **水位与失效**：rewind / 覆盖导入后 token meter 折叠与投影单元缓存必须失效（同一 meter 实例 +
  预热水位）：`meter-watermark.spec.ts`、`compaction-rewind.spec.ts`。
- **浏览器半（编排）**：`SessionEditorController.face`——动作 POST、成功后重建会话窗口（探测顺序
  `binding.resync()` → `sessions.refresh()` → warn，**不整页重载**）、recall 回填**该消息的全部文本块**、
  recall 在**重建落定后**把 `[data-conversation-scroll]` 写到底（重建没落定前不动视口、失败不动视口）、
  失败不阻塞下一次操作、会话列表 / 快照变化不发任何请求：`client-controller.spec.ts`。
- **浏览器半（入口门控）**：`conversation.chat.node` 的 `user` / `steering` 覆盖——编辑只要存在可编辑文本块
  （含轮外消息）、重试仅已闭合轮次、确认后才提交：`chat-node-actions.spec.tsx`。

## 真装配面空缺的判据

`/session-editor` 路由的**注册时机**：`registerHttpRoutes` 用 `ctx.inject(["webServer"])` 等 `webServer`
激活（它可能比本行晚构造），而单测的 `harness()` 直接 provide `webServer`——所以用例只覆盖注册逻辑本身，
看不见真装配里的激活顺序。真装配探针（装配一次真 web profile，看 `POST /session-editor` 是否命中我们自己的
handler，非 405/404 才算过）目前没有。再遇到撤回 / 重试整片 405 的症状，按注册时机排查（`webServer` 激活
晚于本行构造时，请求会落到 `frontend-static` 的 fallback）。

## 测试装配辅助（`./testing`）

- `harness()`：一次性装配 `SessionStore` + 投影注册 + 真实 SQLite rdb + `SessionEditor`，返回
  `{ ctx, editor, dispose }`。
- 日志 fixture：`oneTurnLog` / `twoTurnLog` / `meta` / `createPersisted` / `userMessage` 等。
- **分支语义的端到端用例**在 `branch.spec.ts` / `edit.spec.ts`（真实 SQLite 后端 + coordinator 状态同步 +
  duck-typed agent 驱动）。

## 未覆盖（有明确原因）

- `importSession` 的浏览器半（`FileReader` + `location.reload()` 薄壳）：服务端面由 `@morlay/session-rdb`
  的 `import.spec.ts` 覆盖。
- slot 装配面（`client/index.ts` 的 `apply`：slot 注册）需要 cordis client 运行时 →
  [债务 20260917-对话UI的槽注册面缺真装配用例](../debts/20260917-对话UI的槽注册面缺真装配用例.md)；
  两处槽注册如今只剩 `conversation.chat.node` 这一处（composer 统计行交回官方）。
- **版本导航入口**：`conversation.session.header.utilities` 上只有上游 `ui-open-in-app` / `ui-schedule` 的项，
  我们的版本导航没有注册方，也没有消费方——版本树读取面本身不存在
  （[ADR-20260920-删除版本树投影并停止写版本效果](../../../session-branch/.agents/adrs/20260920-删除版本树投影并停止写版本效果.md)）；
  将来接版本导航要重建读侧。
