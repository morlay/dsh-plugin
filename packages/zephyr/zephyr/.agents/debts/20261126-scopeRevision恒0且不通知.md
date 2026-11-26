# 债：`scopeRevision` 恒 0 且从不通知（切会话不重渲染）

状态：**未修**（2026-11-26 记录，单独一票；比右栏那条更严重，是产品级）。

## 事实（`packages/zephyr/zephyr-app/src/client/renderer/slots.service.ts`）

```
350:  scopeRevision: { getSnapshot: () => this.scopeRevision, subscribe: … }
480:  private scopeRevision = 0;                    ← 全文件唯一赋值
482:  private readonly scopeRevisionListeners = …  ← 从未被 notify
```

`installScope(scope, adapter)` 里只 `this.scopes.set(scope, adapter)` + 一个撤销 effect，**既不 `scopeRevision += 1` 也不通知**。

## 后果

上游渲染器用 `scopeRevision` 判断「scope 集合变没变」。恒 0 + 不通知 → **scope adapter 变化（换会话 / 首次就位）不会触发重渲染**。
症状：切会话后右栏、会话面板等 scope 子树可能停在上一个会话的渲染结果上（`useSession` / `sessionId` 是旧的）。
今天没人报，是因为 dev 下 HMR 会整树重渲染掩盖了它。

## 修法方向

`installScope` 与它的撤销里：`this.scopeRevision += 1; for (const l of listeners) l()`；撤销同理。
**不要**改成「按 adapter 身份比较」——上游契约要求的是一个单调版本号。

## 修复进展（2026-11-26）

`SlotsDefault.installScope` 已补 `bumpScopeRevision()`：装/撤时 `scopeRevision += 1` 并通知订阅者。

## 判据（待补，**(b) 行为级**）

> 装配一个读 `useSession` / `sessionId` 的组件（`session-maybe` scope）→ `installScope('session', adapterA)` → 断言渲染出 `s1`
> → 换 adapterB → 断言渲染出 `s2`。

**不要**给 `Slots` 契约加 `scopeRevisionSnapshot()` / `subscribeScopeRevision()`——那是为测试扩产品契约（已否决）。
上一版判据就是因为用了这两个不存在的方法而编译不过，已删除（不留红着的假判据）。

## 关联

同属「我们的 `Slots` 与上游渲染器的接缝契约」缺口，见 `../designs/20261126-Slots与上游渲染器的接缝契约.md` 第 8 条。
