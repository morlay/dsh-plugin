// 全局目录的 host 半：把部署里**当前可见**的工具名与技能名列出来，供配置页当候选（工具 / 技能名单字段）。
//
// 为什么要有这一层：这两份清单只有 host 侧读得到（工具面在 `ctx.tools`、技能面在 `ctx.skills`），而客户端只有按会话的
// `remote.skills.list`——bundle 配置页却是全局设置面。所以本包自己开一条 Remote 命名空间（贡献常量在
// [`./catalog-remote.ts`](./catalog-remote.ts)，由 client 半自己 mount）。
//
// 清单的范围是"**部署里当前可见的那些**"，不是某一份静态名单：
// - 工具按 agent 收口——实测本部署的工具注册都发生在 agent 层，全局视图（`schemas()` 不传 scope）是空的；
// - 技能按 agent 的收口与工作目录扫——工作区技能要 `cwd` 才看得到，而本行没有自己的工作区上下文。
// 所以两份都按当前活跃 agent 逐个读、去重合并；没有活跃 agent（刚启动、会话一个都没开）时只剩全局层那份。
//
// 不按 preset 分别取：preset 到工具名的映射没有任何服务暴露（工具名由各自的行注册进 agent 层，行清单里只有包名），
// 要"按 preset 分别取"就得为每个 preset 各起一个探针 agent；而候选在页面上是一维标签输入，分组也没有落点。

import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-skill";
import type {} from "@deepseek-ai/dsh-tools";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { CATALOG_NS, type SessionModeCatalogValue } from "./catalog-remote.ts";

// 一个 agent 的工作目录：技能面按 `cwd` 才会扫工作区技能。
function cwdOf(agent: Agent): string | undefined {
  const session = (agent as unknown as { session?: { header?: { cwd?: unknown } } }).session;
  const cwd = session?.header?.cwd;
  return typeof cwd === "string" ? cwd : undefined;
}

// 部署当前可见的工具与技能。
export class SessionModeCatalog extends TypertRemoteService {
  /**
   * @param ctx - owning context (the `session-mode` row).
   */
  constructor(ctx: Context) {
    super(ctx, CATALOG_NS);
  }

  /**
   * List the tool and skill names this deployment currently shows.
   * @returns tool names from the tool registry, and skill names from the skill registry.
   */
  @Remote("list")
  async remoteExportList(): Promise<SessionModeCatalogValue> {
    return { tools: this.toolNames(), skills: await this.skillNames() };
  }

  // 工具名：全局层 + 每个活跃 agent 的可见面（同一名字只留一次）。
  private toolNames(): readonly string[] {
    const tools = this.ctx.get("tools");
    if (tools === undefined) return [];
    const names = new Set(tools.schemas().map((schema) => String(schema.name)));
    for (const agent of this.agents()) {
      for (const schema of tools.schemas(agent)) names.add(String(schema.name));
    }
    return [...names];
  }

  // 技能名：全局层 + 每个活跃 agent 按其收口与工作目录看到的那份。
  private async skillNames(): Promise<readonly string[]> {
    const skills = this.ctx.get("skills");
    if (skills === undefined) return [];
    const names = new Set((await skills.list()).map((row) => row.name));
    for (const agent of this.agents()) {
      for (const row of await skills.list({ scope: agent, cwd: cwdOf(agent) })) {
        names.add(row.name);
      }
    }
    return [...names];
  }

  // 当前活跃的 agent：清单按它们逐个读。服务缺席（极简装配）时按没有处理。
  private agents(): readonly Agent[] {
    return this.ctx.get("agents")?.list() ?? [];
  }
}
