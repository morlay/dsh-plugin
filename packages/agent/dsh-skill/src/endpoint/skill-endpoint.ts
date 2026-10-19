// `skills` 这一组的**跨端契约**：组名、方法名与请求/响应形状。
//
// 宿主侧在 `server/skill-endpoint.service.ts` 实现它，浏览器侧按它消费（`ui/` 的 `@RemoteClient()`）。
// 契约是普通类，不引宿主包——形状照上游 descriptor（`namespace: 'skills'`）抄，字段一个不少。
import { RemoteGroup, RemoteMethod, type RemoteResultWire } from "@morlay/zephyr-app/remote";

/** wire 上的端点名。 */
export const SKILLS_LIST_ENDPOINT = "skills/list";

/** 一条用户可调用的技能（上游 `SkillEntry`）。 */
export interface SkillEntry {
  /** 文件系统给的 `SKILL.md` 绝对路径（没有 provider 时缺省）。 */
  readonly path?: string;
  /** kebab-case 标识，按 `/name` 引用。 */
  readonly name: string;
  /** 路由用的短描述。 */
  readonly description: string;
  /** 额外的路由提示。 */
  readonly whenToUse?: string;
  /** 是否同时投给模型。 */
  readonly modelInvocable: boolean;
}

/** `skills/list` 的请求：一个会话的可见技能。 */
export interface SkillListRequest {
  readonly sessionId: string;
}

/** `skills/list` 的响应。 */
export interface SkillListValue {
  readonly skills: readonly SkillEntry[];
}

/** `skills` 组：一个会话的可见技能清单。 */
@RemoteGroup({ name: "skills" })
export class SkillEndpoint {
  /**
   * 列出一个会话可见的用户可调用技能（不加载技能正文）。
   * @param _request - 目标会话。
   * @returns 技能清单。
   */
  @RemoteMethod()
  async list(_request: SkillListRequest): Promise<RemoteResultWire<SkillListValue>> {
    throw new Error("skills/list：契约类未实现（宿主侧要在子类里实现它）");
  }
}
