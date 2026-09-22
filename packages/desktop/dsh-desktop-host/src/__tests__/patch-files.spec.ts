import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DESKTOP_APP_PATCH_FILENAME, desktopPatchFiles } from "../patch.ts";

const roots: string[] = [];

/** 打包后的 runtime 根：app 层 patch 与宿主自带的 `config/` 都按它定位。 */
async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "dsh-desktop-patch-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("desktop patch layers", () => {
  it("loads only the host's own layer when the runtime ships no app patch", async () => {
    const runtimeDir = await fixture();
    const files = await desktopPatchFiles(runtimeDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/config[/\\]desktop\.cordis\.patch\.yml$/u);
  });

  it("loads the app layer before the host layer, because the host overrides it", async () => {
    const runtimeDir = await fixture();
    await writeFile(join(runtimeDir, DESKTOP_APP_PATCH_FILENAME), "- id: locale\n", "utf8");
    expect(await desktopPatchFiles(runtimeDir)).toEqual([
      join(runtimeDir, DESKTOP_APP_PATCH_FILENAME),
      expect.stringMatching(/config[/\\]desktop\.cordis\.patch\.yml$/u),
    ]);
  });
});
