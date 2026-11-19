// 契约名对上游：本包契约类的 `@Injectable({ name })` 必须等于上游 `super(ctx, '<name>')` 的注册名。
//
// 名字写错的后果是静默的：装配期按别名发布的那一份与上游按名字读的那一份对不上，消费方拿到
// `undefined` 再从别处报错。期望值抄自上游源码（`vendor/deepseek-harness/packages/…`，逐行注明），
// 不由被测代码推导——否则判据就被实现带着走。
import {
  FileReferenceService,
  SessionControllerService,
  SessionFileReferencesService,
  SessionSkillCatalogService,
  SessionTitle,
} from "@morlay/dsh-conversation/contract";
import { tokenMetaOf } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";

/** 表：契约类 → 上游注册名（`super(ctx, '…')` 的第一个参数；设施类的 `provide('…')` 同义）。 */
const contractNames: ReadonlyArray<readonly [object, string]> = [
  // @deepseek-ai/dsh-api-session-controller  api/session-controller/src/index.ts:179
  [SessionControllerService, "sessionController"],
  // @deepseek-ai/dsh-file-reference-local（上游契约 @deepseek-ai/dsh-file-reference）  context/file-reference/src/index.ts:28
  [FileReferenceService, "fileReferences"],
  // @deepseek-ai/dsh-api-session-controller/src/file-references.ts  api/session-controller/src/file-references.ts:22
  [SessionFileReferencesService, "sessionFileReferences"],
  // @deepseek-ai/dsh-api-session-controller/src/skill-catalog.ts  api/session-controller/src/skill-catalog.ts:25
  [SessionSkillCatalogService, "sessionSkillCatalog"],
  // @deepseek-ai/dsh-session-title  session/session-title/src/index.ts:318
  [SessionTitle, "sessionTitle"],
];

describe("契约名对上游注册名", () => {
  for (const [contract, expected] of contractNames) {
    it(`${(contract as { readonly name: string }).name} → ${expected}`, () => {
      expect(tokenMetaOf(contract).alias).toBe(expected);
    });
  }
});
