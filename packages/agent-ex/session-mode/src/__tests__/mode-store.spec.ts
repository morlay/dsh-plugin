// 模式配置文件的读写：`{dshHome}/modes/*.toml`。多行 persona 要写成 TOML 多行字符串，读回逐字不变。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModeOverrides, removeMode, writeMode } from "@morlay/session-mode";

let home: string;
let previous: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "dsh-mode-store-"));
  previous = process.env["DSH_HOME"];
  process.env["DSH_HOME"] = home;
});

afterEach(async () => {
  if (previous === undefined) Reflect.deleteProperty(process.env, "DSH_HOME");
  else process.env["DSH_HOME"] = previous;
  await rm(home, { recursive: true, force: true });
});

describe("模式配置的 TOML 持久化", () => {
  it("多行 persona 写成多行字符串，读回来一致", async () => {
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

  it("读覆盖、删除后不再出现", async () => {
    await writeMode("custom", { name: "自定义" });
    expect((await loadModeOverrides())["custom"]).toMatchObject({ name: "自定义" });

    await removeMode("custom");
    expect((await loadModeOverrides())["custom"]).toBeUndefined();
  });
});
