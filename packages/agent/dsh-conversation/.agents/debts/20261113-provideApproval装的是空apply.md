# `provideApproval()` 装的是上游节点的空 apply（`dsh-conversation`）

状态：已知未销账——应用清单里的 `provideApproval()` 是一次**空转**；审批卡片实际由 `ApprovalSlot` 的 `/client` 行提供
范围：`packages/agent/dsh-conversation/src/ui/approval.service.ts`（`UiApproval` + `provideApproval()`）
非目标：审批的业务语义（宿主 `dsh-permission/src/approval.service.ts`）、卡片本身（上游 `ui-approval`）
关联：[对话域边界与交付物归属](../designs/20261109-对话域边界与交付物归属.md)

## 一、事实

- `src/ui/approval.service.ts` 的 `UiApproval` `fromCordis` 的是 `@deepseek-ai/dsh-client-ui-approval` 的**包根**，
  而那个包根的 `apply()` 是空的（`export function apply(): void {}`，node 半）——装上去不注册任何东西。
- 真正注册槽位的是 `src/ui/approval-slot.ts` 的 `ApprovalSlot`（`@deepseek-ai/dsh-client-ui-approval/client`）。
- 应用清单 `apps/zephyr-custom/src/client/client.provide.ts` 同时装了 `provideApproval()` 与 `ApprovalSlot` 所在的装配函数。

## 二、为什么不顺手删

删 `provideApproval()` 要改 `apps/*` 的清单（跨域）；把它改成 `/client` 会和 `ApprovalSlot` **重复注册**同一个 client 行（槽位冲突）。两件都不属于"修端口边界"这件事。

## 三、销账形态

从 `approval.service.ts` 与该装配函数里删掉包根那一行（`provideApproval()` 随之消失），应用清单去掉对应条目；
之后 `grep -rn 'dsh-client-ui-approval"' packages apps --include='*.ts' | grep -v __tests__` 只剩 `/client` 一处。
