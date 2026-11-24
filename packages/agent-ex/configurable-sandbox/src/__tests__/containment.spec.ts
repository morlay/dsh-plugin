// 路径包含判定：先做字面比较，再沿祖先链比 inode（符号链接指到同一个对象时也算包含）。
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isPathUnder } from "@morlay/configurable-sandbox";
import { describe, expect, test } from "@morlay/zephyr-app/testing";

/**
 * 造一个含 `ws/nested/note.md` 的工作区（判「包含」用的真实目录）。
 * @param tempRoot - 本用例的临时目录（`appEnv.values.dataDir`）。
 * @returns 工作区路径。
 */
async function workspaceAt(tempRoot: string): Promise<string> {
  await mkdir(join(tempRoot, "ws", "nested"), { recursive: true });
  await writeFile(join(tempRoot, "ws", "nested", "note.md"), "hi");
  return join(tempRoot, "ws");
}

describe("isPathUnder", () => {
  test("字面比较：自身与后代算包含，前缀相同的兄弟不算", async ({ appEnv }) => {
    const tempRoot = appEnv.values.dataDir;
    const ws = await workspaceAt(tempRoot);

    expect(await isPathUnder(ws, ws)).toBe(true);
    expect(await isPathUnder(join(ws, "nested", "note.md"), ws)).toBe(true);
    expect(await isPathUnder(join(tempRoot, "wsx"), ws)).toBe(false);
  });

  test("符号链接指到同一个对象时也算包含（inode 判据）", async ({ appEnv }) => {
    const tempRoot = appEnv.values.dataDir;
    const ws = await workspaceAt(tempRoot);
    const link = join(tempRoot, "alias");
    await symlink(ws, link);

    expect(await isPathUnder(join(link, "nested", "note.md"), ws)).toBe(true);
  });

  test("root 不存在且路径不在字面范围内：给 false（不抛）", async ({ appEnv }) => {
    const tempRoot = appEnv.values.dataDir;
    expect(
      await isPathUnder(join(tempRoot, "nowhere", "file"), join(tempRoot, "missing-root")),
    ).toBe(false);
  });
});
