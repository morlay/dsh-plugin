import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { xdgDataHome } from "@morlay/dsh-desktop-shell/dshhome";
import { devStoreHome, resolveDevHome } from "../cli/workspace.ts";

const ORIGINAL = {
  dshHome: process.env.DSH_HOME,
  xdg: process.env.XDG_DATA_HOME,
};

const roots: string[] = [];

async function tempDir(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "dsh-desktopify-dev-home-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  if (ORIGINAL.dshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = ORIGINAL.dshHome;
  if (ORIGINAL.xdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = ORIGINAL.xdg;
});

describe("resolveDevHome", () => {
  it("keeps the workspace store when no --home is given", async () => {
    const workspace = await tempDir();

    expect(resolveDevHome(workspace, "dsh-custom-next", undefined)).toBe(devStoreHome(workspace));
  });

  it("resolves xdg against the app name, matching the packaged home", async () => {
    const workspace = await tempDir();

    expect(resolveDevHome(workspace, "dsh-custom-next", "xdg")).toBe(
      join(xdgDataHome(), "dsh-custom-next"),
    );
  });

  it("takes an absolute path as-is", async () => {
    const workspace = await tempDir();
    const explicit = join(await tempDir(), "home");

    expect(resolveDevHome(workspace, "dsh-custom-next", explicit)).toBe(explicit);
  });

  it("takes the ambient DSH_HOME for env", async () => {
    const workspace = await tempDir();
    const ambient = await tempDir();
    process.env.DSH_HOME = ambient;

    expect(resolveDevHome(workspace, "dsh-custom-next", "env")).toBe(normalize(ambient));
  });

  it("fails loud when env mode has no DSH_HOME to take", async () => {
    const workspace = await tempDir();
    delete process.env.DSH_HOME;

    expect(() => resolveDevHome(workspace, "dsh-custom-next", "env")).toThrow(
      /needs DSH_HOME in the environment/u,
    );
  });

  it("refuses a spec that is neither a known mode nor absolute", async () => {
    const workspace = await tempDir();

    expect(() => resolveDevHome(workspace, "dsh-custom-next", `store${sep}data`)).toThrow(
      /dshHome must be xdg, env, or an absolute path/u,
    );
    expect(() => resolveDevHome(workspace, "dsh-custom-next", "~/data")).toThrow(
      /dshHome must be xdg, env, or an absolute path/u,
    );
  });
});
