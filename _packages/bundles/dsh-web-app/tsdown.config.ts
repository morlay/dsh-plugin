import { join } from "node:path";
import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatch, patchPackagesOf } from "@local/devkit/patch";
import { renderModulePatch, rowsOf, type ModulePatchOptions } from "@local/zephyr-codegen";
import { DshWebAppPatchModule } from "./src/web-app.patch.module.ts";

function upstreamPackages(): ReadonlyMap<string, string> {
  return patchPackagesOf(
    join(import.meta.dirname, "../../../vendor/deepseek-harness/packages/bundle/web-app/cordis.patch.yml"),
  );
}

const patch = {
  module: DshWebAppPatchModule,
  from: import.meta.url,
  packageNameOfRow: (id: string): string | undefined => upstreamPackages().get(id),
  // 直接以上游插件类登记的行（`config-editor` / `settings`）没有 `@Injectable()` 的定义文件记录：
  // 它们的包名由类名的 kebab-case 前缀补出来。
  packageNameOf: (provider: Function): string =>
    upstreamPackages().get(provider.name) ?? `@deepseek-ai/dsh-${provider.name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`,

} satisfies ModulePatchOptions;

export const render = (): Promise<string> => renderModulePatch(patch);
export const sourceUrl: string = patch.from;

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    // client 半按 domain 出契约（token 名即 ctx 服务名），能力包按需引入自己那一域。
    "locale/client/tokens": "./src/locale/client/tokens.ts",
    "renderer/client/tokens": "./src/renderer/client/tokens.ts",
    "session/client/tokens": "./src/session/client/tokens.ts",
    "workspace/client/tokens": "./src/workspace/client/tokens.ts",
    "api-remotes/client/tokens": "./src/api-remotes/client/tokens.ts",
    "settings/client/tokens": "./src/settings/client/tokens.ts",
  },
  plugins: [cordisPlugin(), bundlePatch({ from: patch.from, rows: () => rowsOf(patch.module, patch) })],
});
