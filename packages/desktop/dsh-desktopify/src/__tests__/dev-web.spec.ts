import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syncProfileBundles } from "../cli/dev-web.ts";

async function profile(): Promise<string> {
  const directory = join(await mkdtemp(join(tmpdir(), "dev-web-")), "profile");
  await mkdir(directory, { recursive: true });
  return directory;
}

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
