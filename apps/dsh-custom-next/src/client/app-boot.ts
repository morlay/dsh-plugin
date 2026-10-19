/**
 * 应用的 client 入口（vite 的 root = 本目录）。
 *
 * 只组合链：装配全在 `appClientProviders()`（框架链 + 各业务链）里。
 * 装配与挂载在框架的 `bootstrapClient` 里——入口归应用，能力归框架。
 */
import "@deepseek-ai/dsh-client-ui-theme/brand-font.css";
import "@morlay/zephyr-app/client/base.css";
import { bootstrapClient, installStorageShim } from "@morlay/zephyr-app/client";
import { appClientProviders } from "./index.ts";

// `localStorage` / `sessionStorage` 必须在**任何行装载之前**被代理掉：上游的持久化在 apply 期就读它们。
const storage = await installStorageShim();
if (!storage.installed) {
  console.warn(`[app-boot] storage 代理未安装，回落原生 storage：${storage.reason}`);
}

await bootstrapClient({ providers: appClientProviders() });
