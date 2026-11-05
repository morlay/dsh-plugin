// 路径包含判定：先做字面比较，再沿祖先链比 inode（符号链接指到同一个对象时也算包含）。
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPathUnder } from "@morlay/configurable-sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "configurable-sandbox-contain-"));
  await mkdir(join(root, "ws", "nested"), { recursive: true });
  await writeFile(join(root, "ws", "nested", "note.md"), "hi");
}, 20_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
}, 20_000);

describe("isPathUnder", () => {
  it("字面比较：自身与后代算包含，前缀相同的兄弟不算", async () => {
    const ws = join(root, "ws");

    expect(await isPathUnder(ws, ws)).toBe(true);
    expect(await isPathUnder(join(ws, "nested", "note.md"), ws)).toBe(true);
    expect(await isPathUnder(join(root, "wsx"), ws)).toBe(false);
  });

  it("符号链接指到同一个对象时也算包含（inode 判据）", async () => {
    const ws = join(root, "ws");
    const link = join(root, "alias");
    await symlink(ws, link);

    expect(await isPathUnder(join(link, "nested", "note.md"), ws)).toBe(true);
  });

  it("root 不存在且路径不在字面范围内：给 false（不抛）", async () => {
    expect(await isPathUnder(join(root, "nowhere", "file"), join(root, "missing-root"))).toBe(
      false,
    );
  });
});
