/**
 * skill 域的真装配：真 `SkillRegistry`（上游实现）由我们的 `SkillDefault` 接管，
 * 契约令牌与上游实现令牌指向同一个实例。
 *
 * 行为断言只走契约面 (`registerProvider`) 能观察到的注册表语义：一个名字只能有一个 provider，
 * 返回的 disposer 撤销后名字被释放。目录读取（`list` / `get`）没有契约出口，不在本文件断言。
 */
import type { SkillCandidate, SkillDefinition, SkillProvider } from "@deepseek-ai/dsh-skill";
import { bootstrapApplication } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { provideSkillFilesystem } from "../server/filesystem.provide.ts";
// `SkillModule` 会把工具行（`tool-skill`）一并带上，而工具行要 agent 栈；这组用例只要注册表本身，
// 所以显式列注册表这一行（装配面本来只认 Provider）。
import { SkillDefault } from "../skill.service.ts";
import { Skill } from "../contract/skill.contract.ts";

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
});

/** 一个只报一条技能的 provider。 */
const SKILL: SkillDefinition = {
  name: "demo-skill",
  description: "演示技能",
  content: "正文内容",
  invocation: { modelInvocable: true, userInvocable: true },
  source: "custom",
  provider: "test-provider",
};

const CANDIDATE: SkillCandidate = { ...SKILL, rank: 100, locator: SKILL };

/** 造一个只报一条技能的 provider。 */
function providerOf(name: string): SkillProvider {
  return {
    name,
    list: async () => [CANDIDATE],
    get: async () => SKILL,
  };
}

/** 起真 skill 注册表。 */
async function boot(): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>> }> {
  const app = await bootstrapApplication({
    providers: [SkillDefault, ...provideSkillFilesystem()],
    timeoutMs: 10_000,
  });
  apps.push(app);
  return { app };
}

describe("skill 域", () => {
  it("装配后契约令牌可解析，注册表拒绝同名 provider", async () => {
    const { app } = await boot();

    const contract = app.get(Skill);
    expect(typeof contract.registerProvider).toBe("function");
    // 契约面只露出 `registerProvider`；同名 provider 只能有一个，是注册表自己的规则。
    contract.registerProvider(() => providerOf("dup-provider"));
    expect(() => contract.registerProvider(() => providerOf("dup-provider"))).toThrow(
      /already registered/,
    );
  });

  it("撤销注册后名字被释放：同名 provider 可以重新登记", async () => {
    const { app } = await boot();
    const contract = app.get(Skill);

    const dispose = contract.registerProvider(() => providerOf("reusable-provider"));
    expect(() => contract.registerProvider(() => providerOf("reusable-provider"))).toThrow(
      /already registered/,
    );

    // 契约返回的 disposer 就是「这一条登记」的生命周期：撤销后同名可以再次登记。
    dispose();
    expect(() => contract.registerProvider(() => providerOf("reusable-provider"))).not.toThrow();
  });
});
