import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureClientBundlePlaceholders,
  installProfilePatch,
  syncProfileBundles,
} from "../cli/dev-web.ts";
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
  const directory = join(await mkdtemp(join(tmpdir(), "dev-web-")), "profile");
  await mkdir(directory, { recursive: true });
  return directory;
}

describe("installProfilePatch", () => {
  it("copies the app patch into the profile user layer", async () => {
    const directory = await profile();
    const workspace = await mkdtemp(join(tmpdir(), "dev-web-app-"));
    const patch = "- insert:\n    - id: dev-client-bundles\n";
    await writeFile(join(workspace, "cordis.patch.yml"), patch);
    expect(await installProfilePatch(directory, workspace)).toBe(
      join(directory, "cordis.patch.yml"),
    );
    expect(await readFile(join(directory, "cordis.patch.yml"), "utf8")).toBe(patch);
  });

  it("is a no-op when the app declares no patch", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dev-web-app-"));
    expect(await installProfilePatch(await profile(), workspace)).toBeUndefined();
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

describe("syncProfileBundles", () => {
  it("把 profile 的装配清单刷成 app 定义的那份，保留依赖与其它字段", async () => {
    const directory = await profile();
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify(
        {
          name: "dsh-profile-web",
          private: true,
          dependencies: { "@morlay/older": "link:/tmp/older" },
          dsh: { profile: { bundles: ["@morlay/older"] } },
        },
        undefined,
        2,
      )}\n`,
    );

    const bundles = [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "@morlay/better-session",
      "@morlay/dsh-profile",
    ];
    expect(await syncProfileBundles(directory, bundles)).toBe(join(directory, "package.json"));

    const written = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
      name: string;
      private: boolean;
      dependencies: Record<string, string>;
      dsh: { profile: { bundles: string[] } };
    };
    expect(written.dsh.profile.bundles).toEqual(bundles);
    expect(written.dependencies).toEqual({ "@morlay/older": "link:/tmp/older" });
    expect(written.private).toBe(true);
  });

  it("清单已经一致时不改写文件", async () => {
    const directory = await profile();
    const manifest = {
      name: "dsh-profile-web",
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } },
    };
    const content = `${JSON.stringify(manifest, undefined, 2)}\n`;
    await writeFile(join(directory, "package.json"), content);

    expect(await syncProfileBundles(directory, ["@deepseek-ai/dsh-base"])).toBeUndefined();
    expect(await readFile(join(directory, "package.json"), "utf8")).toBe(content);
  });
});
