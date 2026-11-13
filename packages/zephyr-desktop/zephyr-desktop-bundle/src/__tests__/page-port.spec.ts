import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePort, preferredPortOf, rememberPort, stickyPort } from "../page-port.ts";

describe("页面端口：端口文件", () => {
  it("只认 1024–65535 的整数，坏内容当没有", () => {
    expect(parsePort("50001")).toBe(50001);
    expect(parsePort(" 3080\n")).toBe(3080);
    for (const raw of ["80", "70000", "abc", "3080.5", "", "  ", undefined, "-1"]) {
      expect(parsePort(raw)).toBeUndefined();
    }
  });

  it("记下来的端口能读回（同一个 userData 就还认这个 origin）", async () => {
    const userData = await mkdtemp(join(tmpdir(), "dsh-page-port-"));
    expect(await preferredPortOf(userData)).toBeUndefined();
    await rememberPort(userData, 50001);
    expect(await preferredPortOf(userData)).toBe(50001);
  });
});

describe("页面端口：粘住的规则", () => {
  it("没有记过：探一个并写回（下次就粘住它）", async () => {
    const userData = await mkdtemp(join(tmpdir(), "dsh-page-port-"));
    expect(await stickyPort(userData, { pick: async () => 50001 })).toBe(50001);
    expect(await preferredPortOf(userData)).toBe(50001);
  });

  it("记过且还空着：直接用那个，不再探新端口（origin 不变）", async () => {
    const userData = await mkdtemp(join(tmpdir(), "dsh-page-port-"));
    await rememberPort(userData, 50001);
    let picked = false;
    const port = await stickyPort(userData, {
      probe: async (candidate) => candidate === 50001,
      pick: async () => {
        picked = true;
        return 50002;
      },
    });
    expect(port).toBe(50001);
    expect(picked).toBe(false);
  });

  it("记过但被占用：换一个并写回（下次以新端口为准）", async () => {
    const userData = await mkdtemp(join(tmpdir(), "dsh-page-port-"));
    await rememberPort(userData, 50001);
    expect(await stickyPort(userData, { probe: async () => false, pick: async () => 50002 })).toBe(
      50002,
    );
    expect(await preferredPortOf(userData)).toBe(50002);
  });

  it("端口文件坏掉：当成没记过（而不是拒绝启动）", async () => {
    const userData = await mkdtemp(join(tmpdir(), "dsh-page-port-"));
    await rememberPort(userData, 50001);
    await rememberPort(userData, 50001);
    expect(await stickyPort(userData, { probe: async () => true, pick: async () => 50003 })).toBe(
      50001,
    );
  });
});
