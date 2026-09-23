# 如何验证（编排接缝）

通用规则（证据矩阵、jsdom pragma、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的接缝、装配辅助与未覆盖清单。

## 接缝与守护 spec（`src/__tests__/`）

- **编排（host）**：`ctx.sessionEditor` 的 `edit` / `retry` / `reroll` / `recall` / `rewind` / `fork`——
  四动作的编排语义与重放范围：`{edit,retry,recall,branch,replay,plan}.spec.ts`。
- **传输（webServer）**：`POST /session-editor` 的行为——rewind 前先停运行中的 loop、动作分发与参数校验
  （GET 已随读面删除，返回 405）：`http.spec.ts`。
- **传输（注册面）**：只注册一条 exact `/session-editor`（无 `/api` 前缀重复注册）——POST 六种动作、
  400 / 405 / 409：`http-connection.spec.ts`。
- **水位与失效**：rewind / 覆盖导入后 token meter 折叠与投影单元缓存必须失效（同一 meter 实例 +
  预热水位）：`meter-watermark.spec.ts`、`compaction-rewind.spec.ts`。
- **浏览器半（编排）**：`SessionEditorController.face`——动作 POST、成功后重建会话窗口
  （探测顺序 `binding.resync()` → `sessions.refresh()` → warn；**不整页重载**）、recall 回填**该消息的全部文本块**、
  recall 在**重建落定后**把 `[data-conversation-scroll]` 写到底（重建没落定前不动视口、失败不动视口）、失败不阻塞下一次操作、
  会话列表 / 快照变化不发任何请求：`client-controller.spec.ts`（刷新方式见
  [ADR 浏览器半只保留动作面](../adrs/20260920-浏览器半只保留动作面不挂常驻刷新.md) 的「后续变化」注记）。
- **浏览器半（入口门控）**：`conversation.chat.node` 的 `user` / `steering` 覆盖——编辑只要存在可编辑
  文本块（含轮外消息）、重试仅已闭合轮次、确认后才提交：`chat-node-actions.spec.tsx`
  （门控理由见 [ADR-编辑入口不依赖轮次归属](../adrs/20260917-编辑入口不依赖轮次归属.md)）。
- **composer 统计行**：`conversation.composer.dock` 的 `stats` id 覆盖注册（官方同 id 行让位，
  priority −1）+ `formatCacheHitPercent` 越界输入口径：`composer-stats.spec.ts`（真实 `SlotCore`
  断言赢家 id / priority / locale / 组件）与承载组件的可见契约 `composer-stats-view.spec.tsx`。

## 真装配的检查（单测覆盖不到的）

- **`/session-editor` 路由真的注册上了**：单测的 `harness()` 直接 provide `webServer`，所以注册永远成功——
  它看不见「本行构造时 `webServer` 还没激活」这种顺序问题（一次性 `ctx.get` 取到 undefined 后不再重试，
  路由永不注册；请求于是落到 `frontend-static` 的 fallback，非 GET/HEAD 一律 405——编辑撤回与重试就是这个症状）。
  改动装配或升级上游后跑 `pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-profile.mts`：它装配一次
  真 web profile，检查 preset roster 无 broken，且 `POST /session-editor` 命中我们自己的 handler
  （判据是非 405/404：非法 body 拿到我们自己的 400 文案）。

## 测试装配辅助（`./testing`）

- `harness()`：一次性装配 `SessionStore` + 投影注册 + 真实 SQLite rdb +
  `SessionEditor`，返回 `{ ctx, editor, dispose }`。
- 日志 fixture：`oneTurnLog` / `twoTurnLog` / `meta` / `createPersisted` / `userMessage` 等。
- **分支语义的端到端用例**在 `branch.spec.ts` / `edit.spec.ts`（真实 SQLite 后端 + coordinator 状态
  同步 + duck-typed agent 驱动）。

## 未覆盖（有明确原因）

- `importSession` 的浏览器半（`FileReader` + `location.reload()` 薄壳）：服务端面由 `@morlay/session-rdb`
  的 `import.spec.ts` 覆盖。
- slot 装配面（`client/index.ts` 的 `apply`：slot 注册）需要 cordis client 运行时 →
  [债务 对话UI客户端半的装配面缺测试辅助](../debts/20260917-对话UI客户端半的装配面缺测试辅助.md)；
  纯注册表的部分（`stats` 覆盖）已由 `composer-stats.spec.ts` 覆盖。
- `conversation.session.header.utilities`（版本导航入口）：没有注册方，也没有消费方——版本树读取面本身
  已删除（[ADR-删除版本树投影并停止写版本效果](../../../session-branch/.agents/adrs/20260920-删除版本树投影并停止写版本效果.md)）；
  将来接版本导航要重建读侧。
