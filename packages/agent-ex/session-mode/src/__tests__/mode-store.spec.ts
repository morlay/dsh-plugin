// 模式配置文件的读写：`{dshHome}/modes/*.toml`。多行 persona 要写成 TOML 多行字符串，读回逐字不变。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, test } from "@morlay/session-mode/testing";
import { onTestFinished, vi } from "vitest";
import { loadModeOverrides, removeMode, writeMode } from "@morlay/session-mode";

describe("模式配置的 TOML 持久化", () => {
  test("多行 persona 写成多行字符串，读回来一致", async () => {
    // 每条用例一个空的 DSH_HOME：模式定义的真源是 `{DSH_HOME}/modes/*.toml`。
    const home = await mkdtemp(join(tmpdir(), "dsh-mode-store-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    await writeMode("coding", {
      name: "编码模式",
      persona: { prefix: "第一行\n第二行", suffix: "" },
      allowTools: [],
    });

    const text = await readFile(join(home, "modes", "coding.toml"), "utf8");
    expect(text).toContain('"""');
    const parsed = parse(text) as { persona: { prefix: string } };
    expect(parsed.persona.prefix).toBe("第一行\n第二行");
  });

  test("读覆盖、删除后不再出现", async () => {
    // 每条用例一个空的 DSH_HOME：模式定义的真源是 `{DSH_HOME}/modes/*.toml`。
    const home = await mkdtemp(join(tmpdir(), "dsh-mode-store-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    await writeMode("custom", { name: "自定义" });
    expect((await loadModeOverrides())["custom"]).toMatchObject({ name: "自定义" });

    await removeMode("custom");
    expect((await loadModeOverrides())["custom"]).toBeUndefined();
  });
});
