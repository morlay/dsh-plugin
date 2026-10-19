// `just custom web` 的入口：只做「推导行清单 → `bootstrapApplication({ imports })`」。
// 配置（路径、dev 形态、行清单）都在 `zephyr.module.ts` 的 `@Module` 里，入口不直接塞 providers。
import { bootstrapApplication } from "@morlay/zephyr";
import { clientPackagesOf } from "@morlay/zephyr-app";
import { customWebModuleOf } from "./zephyr.module.ts";

const base = customWebModuleOf([]);
const rows = [...new Set([...(await clientPackagesOf(base)), "@morlay/zephyr-ui"])];
const app = await bootstrapApplication({ imports: [customWebModuleOf(rows)], timeoutMs: 30_000 });

const shutdown = (): void => {
  void app.dispose().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
