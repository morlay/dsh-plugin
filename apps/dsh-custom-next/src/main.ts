// `just custom web` 的入口：只做「推导行清单 → `bootstrapApplication({ providers })`」。
// 配置（路径、dev 形态、行清单）都在 `zephyr.provide.ts` 的 `customProvidersOf` 里，入口不自己拼清单。
import { bootstrapApplication } from "@morlay/zephyr";
import { clientPackagesOf } from "@morlay/zephyr-app";
import { customProvidersOf } from "./zephyr.provide.ts";

const rows = [
  ...new Set([...(await clientPackagesOf(customProvidersOf([]))), "@morlay/zephyr-ui"]),
];
const app = await bootstrapApplication({ providers: customProvidersOf(rows), timeoutMs: 30_000 });

const shutdown = (): void => {
  void app.dispose().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
