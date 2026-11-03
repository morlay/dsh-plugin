/**
 * 版本元数据（`DSH_CLIENT_*`）：设置页的版本行、侧栏的 `<commit>-dirty` 读它们。取值顺序是
 * 环境（宿主注入）→ `prepare` 写的记录 → 现算，这里三条各钉一条。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_BUILD_RECORD, clientBuildMeta, clientMetaDefines } from "../client-meta.ts";

const KEYS = [
  "DSH_CLIENT_VERSION",
  "DSH_CLIENT_COMMIT_HASH",
  "DSH_CLIENT_GIT_DIRTY",
  "DSH_CLIENT_BUILD_PROFILE",
] as const;
const saved = new Map<string, string | undefined>();
let work: string;

beforeEach(async () => {
  for (const key of KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  work = await mkdtemp(join(tmpdir(), "client-meta-"));
});

afterEach(async () => {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(work, { recursive: true, force: true });
});

describe("clientMetaDefines", () => {
  it("给真值：版本、commit、dirty 都换成正文字面量", () => {
    expect(clientMetaDefines({ version: "0.2.2", commit: "936437e", dirty: true })).toMatchObject({
      "process.env.DSH_CLIENT_VERSION": '"0.2.2"',
      "process.env.DSH_CLIENT_COMMIT_HASH": '"936437e"',
      "process.env.DSH_CLIENT_GIT_DIRTY": '"true"',
      "process.env.DSH_CLIENT_BUILD_PROFILE": '"local"',
    });
  });

  it("缺项换成 undefined（前端那几处自己判空），不是字符串 \"undefined\"", () => {
    const defines = clientMetaDefines({});
    expect(defines["process.env.DSH_CLIENT_VERSION"]).toBe("undefined");
    expect(defines["process.env.DSH_CLIENT_COMMIT_HASH"]).toBe("undefined");
    expect(defines["process.env.DSH_CLIENT_GIT_DIRTY"]).toBe("undefined");
  });
});

describe("clientBuildMeta", () => {
  it("环境里的值优先（dshdev / 桌面壳注入）", async () => {
    process.env["DSH_CLIENT_VERSION"] = "1.2.3";
    process.env["DSH_CLIENT_COMMIT_HASH"] = "abc1234";
    expect(await clientBuildMeta(work)).toEqual({ version: "1.2.3", commit: "abc1234" });
  });

  it("其次是 prepare 写下的记录", async () => {
    await mkdir(join(work, ".dsh-build"), { recursive: true });
    await writeFile(
      join(work, CLIENT_BUILD_RECORD),
      JSON.stringify({
        formatVersion: 1,
        environment: {
          DSH_CLIENT_VERSION: "0.2.2",
          DSH_CLIENT_COMMIT_HASH: "936437e",
          DSH_CLIENT_GIT_DIRTY: "true",
        },
      }),
      "utf8",
    );
    expect(await clientBuildMeta(work)).toEqual({
      version: "0.2.2",
      commit: "936437e",
      dirty: true,
    });
  });

  it("都没有时现算：只有 package.json 的版本（这个临时目录不是 git 工作树）", async () => {
    await writeFile(join(work, "package.json"), JSON.stringify({ version: "9.9.9" }), "utf8");
    expect(await clientBuildMeta(work)).toEqual({ version: "9.9.9" });
  });
});
