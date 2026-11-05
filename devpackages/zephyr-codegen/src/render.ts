// 渲染面：行清单交给本包的 `renderPatch` / `generatePatch`（`./patch.ts`），生成物与各 bundle 那份逐字同形。

import { bundlePatch, generatePatch, renderPatch, type PatchBundleOptions } from "./patch.ts";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import type { ModuleClass } from "./meta.ts";
import { rowsOf, type RowsOptions } from "./rows.ts";

export interface ModulePatchOptions extends RowsOptions {
  // bundle 的 `@Module` 类（已 import）。
  readonly module: ModuleClass;
  // 真源的 `import.meta.url`：生成物的头注释与落位都按它推导。
  readonly from: string;
  // 生成物相对 `from` 所在目录的路径，默认 `cordis.patch.yml`。
  readonly file?: string;
}

// 真源文件所在包的根（向上找最近的 package.json）。
function bundleRootOf(from: string): string | undefined {
  for (let dir = dirname(from); ; dir = dirname(dir)) {
    // oxlint-disable-next-line node/no-sync -- 构建期同步解析包根
    if (existsSync(join(dir, "package.json"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

function patchOptions(options: ModulePatchOptions): PatchBundleOptions {
  return {
    from: options.from,
    ...(options.file === undefined ? {} : { file: options.file }),
    rows: () => {
      const bundleRoot = bundleRootOf(options.from);
      return rowsOf(options.module, bundleRoot === undefined ? options : { ...options, bundleRoot });
    },
  };
}

export function renderModulePatch(options: ModulePatchOptions): Promise<string> {
  return renderPatch(patchOptions(options));
}

export function generateModulePatch(options: ModulePatchOptions): Promise<string> {
  return generatePatch(patchOptions(options));
}

// bundle 的构建期出口：渲染函数（测试对照生成物）与写回插件（build 时落盘）。
export interface ModulePatchBundle {
  render(): Promise<string>;
  readonly plugin: ReturnType<typeof bundlePatch>;
}

export function bundlePatchOf(options: ModulePatchOptions): ModulePatchBundle {
  return {
    render: () => renderModulePatch(options),
    plugin: bundlePatch(patchOptions(options)),
  };
}
