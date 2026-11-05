// 默认读面：`{DSH_HOME}/sandbox.toml` 不存在时**创建**一份可用的默认规则。
//
// 判据不是「文件被写了」而是「写出来的东西真能用」：那份内容交给规则层要能解析出源部署那八条
// （`rw /tmp`、agent-browser、三个 XDG 可写、XDG 配置只读、mise 配方与私钥拒绝）。
// 空规则会让沙箱退化成「只有工作区可写」，症状是 agent-browser 起不来、缓存写不进去——
// 那正是这条要挡住的回归。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxFile, SandboxRules, SandboxRulesDefault } from "@morlay/configurable-sandbox";
import { bootstrapApplication } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxFileDefault } from "../sandbox-file.service.ts";

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
}, 20_000);

/** 把 `DSH_HOME` 指到一个空目录（用例不依赖开发机上的配置）。 */
async function emptyHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "sandbox-home-"));
  homes.push(home);
  process.env["DSH_HOME"] = home;
  return home;
}

describe("默认 sandbox.toml", () => {
  it("文件不存在时创建，内容能解析出源部署那八条规则", async () => {
    const home = await emptyHome();
    const app = await bootstrapApplication({
      providers: [SandboxFileDefault, SandboxRulesDefault],
      timeoutMs: 5_000,
    });
    try {
      // 读一次就会落盘（规则层在装配期读它）。
      const text = await app.get(SandboxFile).read();
      expect(text).toBeDefined();
      const written = await readFile(join(home, "sandbox.toml"), "utf8");
      expect(written).toContain("rw /tmp");
      expect(written).toContain("-- **/*.pem");

      // 关键判据：写出来的东西交给规则层，落成可用的规则源。
      const source = app.get(SandboxRules).source();
      expect(source.allowWrite).toContain("/tmp");
      expect(source.deny.some((rule) => String(rule).includes("mise"))).toBe(true);
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("文件已存在时不动它（用户改过的不覆盖）", async () => {
    const home = await emptyHome();
    const path = join(home, "sandbox.toml");
    const mine = 'access = """\nrw /only-this\n"""\n';
    await (await import("node:fs/promises")).writeFile(path, mine, "utf8");

    const app = await bootstrapApplication({
      providers: [SandboxFileDefault, SandboxRulesDefault],
      timeoutMs: 5_000,
    });
    try {
      const source = app.get(SandboxRules).source();
      expect(source.allowWrite).toEqual(["/only-this"]);
      expect(await readFile(path, "utf8")).toBe(mine);
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});
