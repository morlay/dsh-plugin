# `SESSION_EVENT_REJECTED` 域码与上游契约断言冲突

状态：未销账——域码表里有 `SESSION_EVENT_REJECTED`，落盘路径却原样抛上游的 `SessionFormatUnsupportedError`，wire 上取不到这个码。
位置：`packages/agent-ex/better-session/src/data/errors.ts`（码表里的 `SESSION_EVENT_REJECTED`）、`packages/agent-ex/better-session/src/data/store/write-path.ts`（`appendBatch` 里 `validateStoredEvents` 之前的那条注释：不换类型、也不往上游错误上挂 `code`）、上游 `packages/agent/dsh-session-persistence/src/testing/contract.ts`（「vocabulary fail-closed」一条按 `toBeInstanceOf(SessionFormatUnsupportedError)` 断言）。

**现象**

- 事件体被上游词表校验拒绝时，`appendBatch` 原样抛上游 `SessionFormatUnsupportedError`：不改类型，也不往别人的错误对象上挂 `code`（挂上去等于同一个错误有两种身份）。
- `SESSION_EVENT_REJECTED` 只在 `SessionStoreFailure` 里登记，没有任何抛出点；端点只转发 `error.code`，所以这个码到不了 wire。
- 换成本包的 `SessionStoreError` 会直接让上游契约套件红：那条用例断言的是上游错误**类型**，不是码。

**影响**

按域码分派的调用方（页面、CLI）在「事件被拒」这一类上拿不到码，只能退回判 `error.name` 或匹配文案；与「端点错误只有域码一条通道」的口径不一致。排障时也分不清是域层拒绝还是上游校验拒绝。

**触发条件**

要按码分派「事件被拒」之前必须先还：例如页面按码给「这条消息的格式不支持，改一条再发」的提示，或 CLI 按码决定是否重放这一批。眼下没有调用方按这个码分派，所以未销账但未触发。

**销账条件**

Done when：`SESSION_EVENT_REJECTED` 有抛出点，且端点返回 `error.code === "SESSION_EVENT_REJECTED"` 有用例，同时 `persistence-contract.spec.ts` 与 `endpoint.spec.ts` 都绿。两条路任选——上游契约改成按域码断言（或允许包装类型），或本包抛出的错误同时满足 `instanceof SessionFormatUnsupportedError` 并带 `code`。

**不修的理由**

上游不可改（`AGENTS.md` 红线），而改类型会让契约套件红；在错误对象上挂 `code` 会让同一个错误有两种身份，比缺码更难查。眼下没有调用方按这个码分派，成本大于收益。
