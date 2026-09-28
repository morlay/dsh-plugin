// 插件清单页（设置 → 插件）里每个 bundle 的卡片与行图标来自 bundle 包自己的 `icon` 字段：
// host 按包内**相对路径**读那个文件、编码成 data URI 交给页面（上游 `app-boot` 的 package-meta）。
//
// 这里用上游读取器（`readPluginMeta`）实测每个 bundle——漏了文件、路径写错、或没进发布清单，
// 图标就静默退化成默认 artwork（页面上看不出来是配置错了），所以守卫盯的是"真的读得出来"。
import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readPluginMeta } from "@deepseek-ai/dsh-app-boot";
import { describe, expect, it } from "vitest";

interface Bundle {
  readonly name: string;
  readonly dir: string;
  readonly icon: string | undefined;
  readonly files: readonly string[];
}

/** 本仓库自己的 bundle：`packages/bundles/*`（装配清单在 `apps/dsh-custom-next/package.json` 的 `dsh.profile.bundles`）。 */
async function bundles(): Promise<Bundle[]> {
  const found: Bundle[] = [];
  for await (const file of glob("packages/bundles/*/package.json", { cwd: process.cwd() })) {
    const dir = join(process.cwd(), file, "..");
    const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      name: string;
      icon?: unknown;
      files?: string[];
    };
    found.push({
      name: manifest.name,
      dir,
      icon: typeof manifest.icon === "string" ? manifest.icon : undefined,
      files: manifest.files ?? [],
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const found = await bundles();

describe("bundle 图标声明", () => {
  it("有 bundle 可查（守卫本身没空转）", () => {
    expect(found.length).toBeGreaterThan(2);
  });

  it("每个 bundle 都声明了包内相对的图标路径，且文件在发布清单里", () => {
    for (const bundle of found) {
      expect(bundle.icon, `${bundle.name} 未声明 icon`).toMatch(/^\.\//u);
      const relative = bundle.icon?.replace(/^\.\//u, "") ?? "";
      // 发布物少了它，别人装出来的包就没有图标（本仓库开发态看不到差异）。
      expect(bundle.files, `${bundle.name} 的 files 漏了 ${relative}`).toContain(relative);
    }
  });

  it("上游读取器能把每个 bundle 的图标读成 data URI", async () => {
    for (const bundle of found) {
      const parentURL = pathToFileURL(join(bundle.dir, "package.json")).href;
      const meta = readPluginMeta(bundle.name, parentURL);

      expect(meta?.error, bundle.name).toBeUndefined();
      const icon = meta?.icon;
      expect(icon, `${bundle.name} 的图标读不出来`).toMatch(/^data:image\/svg\+xml;base64,/u);
      const svg = Buffer.from(icon?.split(",")[1] ?? "", "base64").toString("utf8");
      expect(svg, `${bundle.name} 的图标不是 SVG`).toContain("<svg");
    }
  });

  it("图标按上游 artwork 的 36×36 排面绘制（否则在卡片里与官方图标不同比例）", async () => {
    for (const bundle of found) {
      const svg = await readFile(join(bundle.dir, bundle.icon ?? "icon.svg"), "utf8");
      expect(svg, bundle.name).toContain('viewBox="0 0 36 36"');
      expect(svg, bundle.name).toContain('xmlns="http://www.w3.org/2000/svg"');
      // 上游 artwork 一律透明底自绘形（fill="none" 起步），不靠外框背景。
      expect(svg, bundle.name).toContain('fill="none"');
    }
  });
});
