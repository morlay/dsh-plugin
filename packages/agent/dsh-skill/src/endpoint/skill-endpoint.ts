// `skills` 这一组的**跨端契约**：组名、方法名与 wire 的形参 / 应答类型。
//
// 上游真源：`vendor/deepseek-harness/packages/api/session-controller/src/skill-catalog.ts:36`
// （`SessionSkillCatalog`，namespace `skills`）：`list(request, signal): Promise<SkillListValue>`——
// 位置形参、裸值。类型全部取上游 `.../session-controller/types.ts`（`SkillEntry` / `SkillListRequest` /
// `SkillListValue`），不手抄。
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn, DropParam } from "@morlay/zephyr-app/typert";
import type { SessionSkillCatalog as SkillCatalogHost } from "@deepseek-ai/dsh-api-session-controller";
import type { SkillListRequest, SkillListValue } from "@deepseek-ai/dsh-api-session-controller/types";
import { RemoteGroup, RemoteMethod, groupNameOf } from "@morlay/zephyr-app/remote";

export type { SkillEntry, SkillListRequest, SkillListValue } from "@deepseek-ai/dsh-api-session-controller/types";

/**
 * 组名（`skills`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function skillsGroupName(): string {
  return groupNameOf(SkillEndpoint);
}

/** `skills` 组：一个会话的可见技能清单。 */
@RemoteGroup({ name: "skills" })
export class SkillEndpoint {
  /**
   * 列出一个会话可见的用户可调用技能（不加载技能正文）。
   * @param _request - 目标会话（wire 名 `request`）。
   * @returns 技能清单。
   */
  @RemoteMethod({ parameters: ["request"] })
  async list(_request: SkillListRequest): Promise<SkillListValue> {
    throw new Error("skills/list：契约类未实现（宿主侧要在子类里实现它）");
  }
}

/**
 * 覆盖守卫：契约对上**宿主类** `SessionSkillCatalog` 的 wire 面。
 *
 * 投影两步：`DropParam`（末尾 `signal` 走 cancellation）→ `AsyncReturn`（异步化；本组无 lookup 形参）。
 */
export type SkillEndpointCovered = AssertTrue<
  AssertWireFace<
    Pick<AsyncReturn<DropParam<SkillCatalogHost, AbortSignal>>, "list">,
    Pick<SkillEndpoint, "list">
  >
>;
