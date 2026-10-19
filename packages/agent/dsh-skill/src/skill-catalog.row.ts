// `skills` 组的上游适配行：把上游 `SessionSkillCatalog`（`TypertRemoteService`，namespace `skills`）接管成
// 本仓的契约令牌 `SkillCatalogHost`。端点行（`server/skill-endpoint.service.ts`）只按契约注入它。
import { SessionSkillCatalog } from "@deepseek-ai/dsh-api-session-controller";
import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionQuery } from "@morlay/dsh-session";
import { Skill } from "@morlay/dsh-skill";
import { WorkingDirectory } from "@morlay/dsh-working-directory";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Typert } from "@morlay/zephyr-app";

/** 本组命名空间的契约（`remote.skills` 的宿主面）。 */
@Injectable()
export abstract class SkillCatalogHost {
  /** 上游 typert 生成的绑定描述。 */
  abstract readonly typertRemote: unknown;
}

/** 适配行：`fromCordis(契约, 上游类)`，deps 随 `mount` 交出。 */
@Injectable()
export class SkillCatalogRow extends fromCordis(SkillCatalogHost, SessionSkillCatalog) {
  private readonly agents = inject(AgentDirectory);

  private readonly sessionQuery = inject(SessionQuery);

  private readonly typert = inject(Typert);

  private readonly workingDirectory = inject(WorkingDirectory);

  /** `skills`：上游服务用 `ctx.get('skills')` 取技能注册表（可选读）。 */
  private readonly skills = inject(Skill);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      sessionQuery: this.sessionQuery,
      typert: this.typert,
      workingDirectory: this.workingDirectory,
      skills: this.skills,
    });
  }
}
