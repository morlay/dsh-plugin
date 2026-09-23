// 插件清单页（设置 → 插件）的标题与描述来自插件包自己的 `locale/<lang>.json`：`en.json` 是基准，
// 同目录的其它语言文件提供各自语言，且两者都要在 package.json 的 exports 里暴露——否则解析不到。
//
// 这里用上游的读取器（`readPluginMeta`）实测每个发布包：漏了文件、少写了 meta 字段、或没暴露出口，
// 清单页上就会退化成英文 name/description（甚至报错），所以这条守卫盯的是"真的读得出来"。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readPluginMeta } from "@deepseek-ai/dsh-app-boot";
import { describe, expect, it } from "vitest";

interface Publishable {
  readonly name: string;
  readonly dir: string;
}

/** 所有发布包：`packages/<group>/<pkg>/package.json`（devpackages 的 `@local/*` 不发布）。 */
async function publishablePackages(): Promise<Publishable[]> {
  const { glob } = await import("node:fs/promises");
  const found: Publishable[] = [];
  for await (const file of glob("packages/*/*/package.json", { cwd: process.cwd() })) {
    const dir = join(process.cwd(), file, "..");
    const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      name: string;
    };
    found.push({ name: manifest.name, dir });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const packages = await publishablePackages();

describe("插件清单的多语言声明", () => {
  it("有发布包可查（守卫本身没空转）", () => {
    expect(packages.length).toBeGreaterThan(10);
  });

  it("每个包都声明了 locale 出口与发布清单", async () => {
    for (const pkg of packages) {
      const manifest = JSON.parse(await readFile(join(pkg.dir, "package.json"), "utf8")) as {
        exports?: Record<string, unknown>;
        publishConfig?: { exports?: Record<string, unknown> };
        files?: string[];
      };

      expect(manifest.exports?.["./locale/*.json"], pkg.name).toBe("./locale/*.json");
      // 发布态用 publishConfig.exports：那里漏了，装出来的包就读不到 locale。
      expect(
        (manifest.publishConfig?.exports ?? manifest.exports)?.["./locale/*.json"],
        pkg.name,
      ).toBe("./locale/*.json");
      expect(manifest.files ?? [], pkg.name).toContain("locale/*.json");
    }
  });

  it("上游读取器能读出中英文标题与描述", async () => {
    /** 读出来的本地化文本是 `{ en, <lang>: … }` 的语言表。 */
    const languages = (value: unknown): Record<string, string> =>
      (value ?? {}) as Record<string, string>;

    for (const pkg of packages) {
      const parentURL = pathToFileURL(join(pkg.dir, "package.json")).href;
      const meta = readPluginMeta(pkg.name, parentURL);

      expect(meta?.error, pkg.name).toBeUndefined();
      const title = languages(meta?.title);
      const description = languages(meta?.description);
      expect(title["en"], `${pkg.name} 缺英文标题`).toBeTruthy();
      expect(title["zh"], `${pkg.name} 缺中文标题`).toBeTruthy();
      expect(description["en"], `${pkg.name} 缺英文描述`).toBeTruthy();
      expect(description["zh"], `${pkg.name} 缺中文描述`).toBeTruthy();
    }
  });
});
