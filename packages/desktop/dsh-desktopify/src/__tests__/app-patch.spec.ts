import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DESKTOP_APP_PATCH_FILENAME } from "@morlay/dsh-desktop-host/patch";
import { installAppPatch, seedEntries } from "../cli/prepare-seed.ts";

const roots: string[] = [];

interface Fixture {
  /** app workspace：`cordis.patch.yml` 是 app 自己的装配行。 */
  readonly workspace: string;
  /** 部署 runtime 根：host 从这里读 overlay 层。 */
  readonly runtimeDir: string;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(resolve(tmpdir(), "dsh-desktopify-app-patch-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  const runtimeDir = join(root, "runtime");
  await mkdir(workspace, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  return { workspace, runtimeDir };
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("app patch layer", () => {
  it("copies the app's own patch into the runtime the host boots from", async () => {
    const { workspace, runtimeDir } = await fixture();
    const content = "- id: locale\n  config:\n    preference: zh\n";
    await writeFile(join(workspace, "cordis.patch.yml"), content, "utf8");

    expect(await installAppPatch(workspace, runtimeDir)).toBe(
      join(runtimeDir, DESKTOP_APP_PATCH_FILENAME),
    );
    expect(await readFile(join(runtimeDir, DESKTOP_APP_PATCH_FILENAME), "utf8")).toBe(content);
  });

  it("ships no app patch when the workspace has none, so the host boots on its own layer", async () => {
    const { workspace, runtimeDir } = await fixture();

    expect(await installAppPatch(workspace, runtimeDir)).toBeUndefined();
    expect(await exists(join(runtimeDir, DESKTOP_APP_PATCH_FILENAME))).toBe(false);
  });
});

describe("profile seed entries", () => {
  it("leaves the profile patch out of the seed, because that file belongs to the user", () => {
    expect(
      seedEntries("/workspace", { files: ["icon.svg", "cordis.patch.yml", "justfile"] }),
    ).toEqual(["icon.svg", "justfile", "package.json"]);
  });

  it("still seeds the workspace files the profile needs", () => {
    expect(seedEntries("/workspace", { files: ["icon.svg"] })).toEqual([
      "icon.svg",
      "package.json",
    ]);
  });
});
