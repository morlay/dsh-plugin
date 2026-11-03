/**
 * 版本元数据（`DSH_CLIENT_*`）：设置页的版本行、侧栏的 `<commit>-dirty` 读它们。取值顺序是
 * 环境（宿主注入）→ `prepare` 写的记录 → 现算，这里三条各钉一条。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_BUILD_RECORD, clientBuildMeta, clientMetaDefines } from "../client-meta.ts";

// 除了那四个注入值，`DEEPSEEK_HARNESS_VERSION` 也要隔离：现算分支优先读它（mise 会往进程里灌），
// 不隔离的话"没有环境值时现算"这条测的就不是 fixture 了。
const KEYS = [
  "DSH_CLIENT_VERSION",
  "DSH_CLIENT_COMMIT_HASH",
  "DSH_CLIENT_GIT_DIRTY",
  "DSH_CLIENT_BUILD_PROFILE",
  "DEEPSEEK_HARNESS_VERSION",
] as const;

/** fixture 自己的版本：断言它，而不是某个具体版本号。 */
const FIXTURE_VERSION = "1.2.3-rc.1";
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
  it("给真值：每个键换成正文字面量（值原样透传，不在这里定）", () => {
    const meta = { version: "1.2.3-rc.1", commit: "abc1234", dirty: true, profile: "official" };
    expect(clientMetaDefines(meta)).toMatchObject({
      "process.env.DSH_CLIENT_VERSION": JSON.stringify(meta.version),
      "process.env.DSH_CLIENT_COMMIT_HASH": JSON.stringify(meta.commit),
      "process.env.DSH_CLIENT_GIT_DIRTY": JSON.stringify("true"),
      "process.env.DSH_CLIENT_BUILD_PROFILE": JSON.stringify(meta.profile),
    });
  });

  it("缺项换成 undefined（前端那几处自己判空），不是字符串 \"undefined\"", () => {
    const defines = clientMetaDefines({});
    expect(defines["process.env.DSH_CLIENT_VERSION"]).toBe("undefined");
    expect(defines["process.env.DSH_CLIENT_COMMIT_HASH"]).toBe("undefined");
    expect(defines["process.env.DSH_CLIENT_GIT_DIRTY"]).toBe("undefined");
    expect(defines["process.env.DSH_CLIENT_BUILD_PROFILE"]).toBe("undefined");
  });
});

describe("clientBuildMeta", () => {
  it("环境里的值优先（dshdev / 桌面壳注入）", async () => {
    process.env["DSH_CLIENT_VERSION"] = "1.2.3-rc.1";
    process.env["DSH_CLIENT_COMMIT_HASH"] = "abc1234";
    process.env["DSH_CLIENT_BUILD_PROFILE"] = "local";
    expect(await clientBuildMeta(work)).toEqual({
      version: "1.2.3-rc.1",
      commit: "abc1234",
      profile: "local",
    });
  });

  it("其次是 prepare 写下的记录", async () => {
    await mkdir(join(work, ".dsh-build"), { recursive: true });
    await writeFile(
      join(work, CLIENT_BUILD_RECORD),
      JSON.stringify({
        formatVersion: 1,
        environment: {
          DSH_CLIENT_VERSION: "1.2.3-rc.1",
          DSH_CLIENT_COMMIT_HASH: "abc1234",
          DSH_CLIENT_GIT_DIRTY: "true",
        },
      }),
      "utf8",
    );
    expect(await clientBuildMeta(work)).toEqual({
      version: "1.2.3-rc.1",
      commit: "abc1234",
      dirty: true,
    });
  });

  it("都没有时现算：只有 package.json 的版本（这个临时目录不是 git 工作树）", async () => {
    await writeFile(
      join(work, "package.json"),
      JSON.stringify({ version: FIXTURE_VERSION }),
      "utf8",
    );
    expect(await clientBuildMeta(work)).toEqual({ version: FIXTURE_VERSION });
  });

  it("现算也认 `DEEPSEEK_HARNESS_VERSION`（装的是哪一版 harness）", async () => {
    await writeFile(
      join(work, "package.json"),
      JSON.stringify({ version: FIXTURE_VERSION }),
      "utf8",
    );
    process.env["DEEPSEEK_HARNESS_VERSION"] = "9.9.9-other.1";
    expect(await clientBuildMeta(work)).toEqual({ version: "9.9.9-other.1" });
  });
});
