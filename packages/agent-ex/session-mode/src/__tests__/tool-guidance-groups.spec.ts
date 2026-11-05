// `ToolGuidance` 的 `groups` 开关：**预处理**恒开，**用法分组**由部署选。
//
// 判据是两件互不牵连的事：
// 1. 汉化（工具描述换一行中文 + 剥参数说明）在任何配置下都做；
// 2. `groups: false` 时不注册组 skill、不注入 `init` 组正文（那条路会改 system 前缀，逐 token 计费与缓存都受影响）。
//
// 用**假 skill 注册表**而不是 `provideSkill()`：真那一行的依赖链（working-directory → fs → 沙箱 → subprocess）
// 与本判据无关，装上只会让这条用例红在别处。
import { defineTool } from "@morlay/dsh-agent/contract";
import { ToolRegistry } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { Skill } from "@morlay/dsh-skill";
import {
  bootstrapApplication,
  configure,
  inject,
  Injectable,
  type App,
  type OnInit,
} from "@morlay/zephyr";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { ToolGuidance } from "@morlay/session-mode";
import { provideSessionMode } from "@morlay/session-mode";
import { afterEach, describe, expect, it } from "vitest";
import { pinDshHome } from "./support/dsh-home.ts";

pinDshHome();

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/** 假注册表：只记 register 的名字，其余面给空实现。 */
@Injectable()
export class FakeSkill extends Skill {
  readonly names: string[] = [];

  readonly registerProvider = (() => () => undefined) as never;

  readonly get = (() => undefined) as never;

  readonly list = () => [] as never;

  readonly register = ((skill: { name: string }) => {
    this.names.push(skill.name);
    return () => undefined;
  }) as never;

  readonly snapshot = (() => undefined) as never;
}

/**
 * 一条带英文描述的工具：汉化之后描述变中文。
 *
 * 用 `web_search`（`web-access` 组，`injection: "on-demand"`）而不是 `read`：
 * `init` 组**不进** skill 目录（它的正文已常驻注入），拿它验「注册了组 skill」永远得到 0。
 */
function webSearchTool() {
  return defineTool({
    name: "web_search",
    description: "Search the web.",
    parameters: { query: { type: "string", description: "Search query" } },
    output: { schema: { type: "string" }, render: () => [] },
    execute: async () => "ok",
  });
}

/**
 * 在**装配期**就把 `web_search` 注册进全局注册表。
 *
 * 组是否注册的判据是「组里有没有工具在场」。晚注册（MCP 连上、skill 重载）那一档由本行跟
 * `tools/change` 补——下面第二条用例钉的正是它。
 */
@Injectable()
export class SeedTools implements OnInit {
  private readonly tools = inject(ToolRegistry);

  onInit(): void {
    this.tools.register(webSearchTool());
  }
}

/** 起一份装配；`groups` 显式给时才覆盖 `ToolGuidance` 的默认。 */
async function boot(groups?: boolean): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideAgent(),
      FakeSkill,
      SeedTools,
      RemoteHandlersDefault,
      ...(groups === undefined
        ? provideSessionMode()
        : provideSessionMode(configure(ToolGuidance, { groups }))),
    ],
    timeoutMs: 30_000,
  });
  opened.push(app);
  return app;
}

function groupSkillNames(app: App): string[] {
  return app.get(FakeSkill).names.filter((name) => name.startsWith("tool-group-"));
}

describe("ToolGuidance 的 groups 开关", () => {
  it("组说明不再进 skill 目录（改由 describe_tool 按组返回）", async () => {
    const app = await boot();
    expect(groupSkillNames(app)).toEqual([]);
  });

  it("groups: false：不注册组 skill，但汉化照做", async () => {
    const app = await boot(false);
    expect(groupSkillNames(app)).toEqual([]);
    const definition = app
      .get(ToolRegistry)
      .definitions()
      .find((tool) => tool.name === "web_search");
    expect(definition?.description).toContain("联网搜索");
  });

  it("晚注册的工具也一样：组说明走 describe_tool，不进 skill 目录", async () => {
    const app = await boot();
    app.get(ToolRegistry).register(
      defineTool({
        name: "read_mcp_resource",
        description: "Read an MCP resource.",
        parameters: { uri: { type: "string" } },
        output: { schema: { type: "string" }, render: () => [] },
        execute: async () => "ok",
      }),
    );

    // 晚注册（MCP 重连 / skill 重载）不会再生出 skill 目录项。
    expect(groupSkillNames(app)).toEqual([]);
  });
});
