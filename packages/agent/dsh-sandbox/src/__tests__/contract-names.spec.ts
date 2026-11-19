// 契约名对上游：本包契约类的 `@Injectable({ name })` 必须等于上游 `super(ctx, '<name>')` 的注册名。
//
// 名字写错的后果是静默的：装配期按别名发布的那一份与上游按名字读的那一份对不上，消费方拿到
// `undefined` 再从别处报错。期望值抄自上游源码（`vendor/deepseek-harness/packages/…`，逐行注明），
// 不由被测代码推导——否则判据就被实现带着走。
import { Sandbox, SandboxPolicy } from "@morlay/dsh-sandbox/contract";
import { tokenMetaOf } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";

/** 表：契约类 → 上游注册名（`super(ctx, '…')` 的第一个参数；设施类的 `provide('…')` 同义）。 */
const contractNames: ReadonlyArray<readonly [object, string]> = [
  // @deepseek-ai/dsh-sandbox  sandbox/sandbox/src/index.ts:210
  [Sandbox, "sandbox"],
  // @deepseek-ai/dsh-sandbox-policy  sandbox/sandbox-policy/src/index.ts:158
  [SandboxPolicy, "sandboxPolicy"],
];

describe("契约名对上游注册名", () => {
  for (const [contract, expected] of contractNames) {
    it(`${(contract as { readonly name: string }).name} → ${expected}`, () => {
      expect(tokenMetaOf(contract).alias).toBe(expected);
    });
  }
});
