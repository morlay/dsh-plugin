import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DESKTOPIFY_PACKAGE } from "../cli/dev.ts";
import { installProfilePatch, syncProfileBundles } from "../cli/dev-web.ts";

// 示例工作区：dev 的 client bundle patch 行写在那里。
const APP_WORKSPACE = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "apps",
  "dsh-custom-next",
);

async function profile(): Promise<string> {
  const directory = join(await mkdtemp(join(tmpdir(), "dev-web-")), "profile");
  await mkdir(directory, { recursive: true });
  return directory;
}

describe("dev client bundles 行", () => {
  // 那一行在 app 的 patch 里按包名 + 出口写，而实现（`./dev-client-bundles`）就在本包：
  // `prepareWebProfile` 因此得把本包 link 进 profile（app 只把 desktopify 声明成 peer）。
  // 任一侧改名都要一起改，否则 profile 里解析不到那行，dev 的现场打包静默失效。
  it("app patch 里的行名与本包名同源", async () => {
    const patch = await readFile(join(APP_WORKSPACE, "cordis.patch.yml"), "utf8");
    expect(patch).toContain(`name: "${DESKTOPIFY_PACKAGE}/dev-client-bundles"`);
  });
});

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
