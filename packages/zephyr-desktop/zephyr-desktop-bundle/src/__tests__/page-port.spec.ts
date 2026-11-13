import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAGE_PORT_FILE,
  parsePort,
  portConflictHint,
  portFor,
  preferredPortOf,
} from "../page-port.ts";

/** 造一个空的 userData。 */
async function userDataOf(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dsh-page-port-"));
}

/** 读端口文件原文。 */
async function rawPortOf(userData: string): Promise<string> {
  return readFile(join(userData, PAGE_PORT_FILE), "utf8");
}

describe("页面端口：解析", () => {
  it("只认 1024–65535 的整数，坏内容当没有", () => {
    expect(parsePort("50001")).toBe(50001);
    expect(parsePort(" 3080\n")).toBe(3080);
    for (const raw of ["80", "70000", "abc", "3080.5", "", "  ", undefined, "-1"]) {
      expect(parsePort(raw)).toBeUndefined();
    }
  });
});

describe("页面端口：选哪个（origin 就是存储身份）", () => {
  it("第一次（没有记录）：探一个并写回", async () => {
    const userData = await userDataOf();
    const choice = await portFor({ userData, pick: async () => 50001 });
    expect(choice).toEqual({ kind: "ok", port: 50001, source: "fresh" });
    expect((await rawPortOf(userData)).trim()).toBe("50001");
  });

  it("记过且还空着：直接用那个，不再探新端口", async () => {
    const userData = await userDataOf();
    await portFor({ userData, pick: async () => 50001 });
    let picked = false;
    const choice = await portFor({
      userData,
      probe: async (candidate) => candidate === 50001,
      pick: async () => {
        picked = true;
        return 50002;
      },
    });
    expect(choice).toEqual({ kind: "ok", port: 50001, source: "remembered" });
    expect(picked).toBe(false);
  });

  it("记过但被外部进程占着：报冲突，**不换端口**（换了就是把页面存储另起一份）", async () => {
    const userData = await userDataOf();
    await portFor({ userData, pick: async () => 50001 });
    let picked = false;
    const choice = await portFor({
      userData,
      probe: async () => false,
      pick: async () => {
        picked = true;
        return 50002;
      },
    });
    expect(choice).toEqual({ kind: "conflict", port: 50001 });
    expect(picked).toBe(false);
    expect((await rawPortOf(userData)).trim()).toBe("50001");
  });

  it("记录损坏：重新选并写回（来源标 corrupt，好让日志提醒页面存储将另起）", async () => {
    const userData = await userDataOf();
    await portFor({ userData, pick: async () => 50001 });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(userData, PAGE_PORT_FILE), "not-a-port", "utf8");
    const choice = await portFor({ userData, pick: async () => 50002 });
    expect(choice).toEqual({ kind: "ok", port: 50002, source: "corrupt" });
    expect((await rawPortOf(userData)).trim()).toBe("50002");
  });

  it("--port 显式值：优先并写回（用户显式选的 origin 就是新的归属）", async () => {
    const userData = await userDataOf();
    await portFor({ userData, pick: async () => 50001 });
    const choice = await portFor({
      userData,
      explicit: 50009,
      probe: async () => false,
      pick: async () => 50002,
    });
    expect(choice).toEqual({ kind: "ok", port: 50009, source: "explicit" });
    expect((await rawPortOf(userData)).trim()).toBe("50009");
    expect(await preferredPortOf(userData)).toBe(50009);
  });
});

describe("页面端口：冲突提示", () => {
  const hint = portConflictHint({ port: 50001, userData: "/home/x/profile" });

  it("说清代价并给三条出口", () => {
    expect(hint).toContain("50001");
    expect(hint).toContain("/home/x/profile/page-port");
    expect(hint).toContain("不自动换端口");
    expect(hint).toContain("--port");
    expect(hint).toContain("--user-data-dir");
    expect(hint).toContain("lsof");
  });
});
