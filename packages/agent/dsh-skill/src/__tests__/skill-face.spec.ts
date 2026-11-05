// 技能注册表的契约面：`SessionScope` 按 `skill.list({ scope })` 读技能目录，
// 所以"注入到的 `Skill` 上 `list` 必须是函数"是一条独立接缝——它坏了的表现是
// `sessionMode/active` 整个 500（`TypeError: skill.list is not a function`）。
//
// **只装这条接缝要的那几行**：注册表本体 + 上游 `SessionSkillCatalog`（它
// `super(ctx, 'sessionSkillCatalog', { namespace: 'skills' })`，同一个 namespace 会被挑面选中）。
// 工具行与端点行不在判据里，装上只会拽进半套会话栈。
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { Skill, SkillDefault } from "@morlay/dsh-skill";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 30_000);

describe("技能注册表的契约面", () => {
  it("注入到的 Skill 上 list / get / snapshot 都是函数", async () => {
    const app = await bootstrapApplication({
      providers: [SkillDefault],
      timeoutMs: 20_000,
    });
    opened.push(app);
    const skill = app.get(Skill) as unknown as Record<string, unknown>;
    expect(typeof skill["list"]).toBe("function");
    expect(typeof skill["get"]).toBe("function");
    expect(typeof skill["snapshot"]).toBe("function");
  });
});
