import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { devWebArgs, ensureClientBundlePlaceholders } from "../cli/dev-web.ts";
import type { DevWebConfig } from "../cli/workspace.ts";

const CONFIG: DevWebConfig = {
  prefixes: ["@morlay/"],
  packages: [],
};

async function writePackage(
  profileDir: string,
  name: string,
  options: { source: boolean; built: boolean },
): Promise<string> {
  const root = join(profileDir, "node_modules", ...name.split("/"));
  await mkdir(join(root, "dist"), { recursive: true });
  const exports = { "./client": { types: "./src/client/index.ts", default: "./dist/client.cjs" } };
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name, exports })}\n`);
  if (options.source) {
    await mkdir(join(root, "src", "client"), { recursive: true });
    await writeFile(join(root, "src", "client", "index.ts"), "export function apply(): void {}\n");
  }
  if (options.built) await writeFile(join(root, "dist", "client.cjs"), "// built bytes\n");
  return root;
}

async function profile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "dev-web-")), "profile");
}

describe("dev web launch args", () => {
  it("hands the app layer in as a --patch overlay instead of writing the profile user layer", () => {
    expect(devWebArgs("3080", "/build/development/app.cordis.patch.yml")).toEqual([
      "web",
      "--port",
      "3080",
      "--patch",
      "/build/development/app.cordis.patch.yml",
    ]);
  });

  it("boots the profile alone when the app declares no patch", () => {
    expect(devWebArgs("3080", undefined)).toEqual(["web", "--port", "3080"]);
  });
});

describe("ensureClientBundlePlaceholders", () => {
  it("fills only the local packages that have source but no built bundle", async () => {
    const directory = await profile();
    const placeholder = await writePackage(directory, "@morlay/pkg", {
      source: true,
      built: false,
    });
    const built = await writePackage(directory, "@morlay/built", { source: true, built: true });
    const noSource = await writePackage(directory, "@morlay/no-source", {
      source: false,
      built: false,
    });
    const foreign = await writePackage(directory, "@other/pkg", { source: true, built: false });

    expect(await ensureClientBundlePlaceholders(directory, CONFIG)).toEqual(["@morlay/pkg"]);
    expect(await readFile(join(placeholder, "dist", "client.cjs"), "utf8")).toContain(
      'window.__ModuleLoader__.load({ id: "@morlay/pkg", factory: () => ({}) });',
    );
    expect(await readFile(join(built, "dist", "client.cjs"), "utf8")).toBe("// built bytes\n");
    await expect(readFile(join(noSource, "dist", "client.cjs"), "utf8")).rejects.toThrow();
    await expect(readFile(join(foreign, "dist", "client.cjs"), "utf8")).rejects.toThrow();
  });

  it("is a no-op without a node_modules tree", async () => {
    expect(await ensureClientBundlePlaceholders(await profile(), CONFIG)).toEqual([]);
  });
});
