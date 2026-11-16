import { provide } from "@morlay/zephyr";
import { ServerHmr } from "../internal/server-hmr.ts";

/**
 * 开发态的**服务端 HMR**（`DevHmr` 的实现在 `zephyr-app` 的这一份）。
 *
 * 只有装配面显式装它才有：生产形态不需要（那时源码不变），测试也不需要（会拖长拆卸）。
 * 装完还要由入口 `install({ restart, isIdle? })`——`zephyr-app` 不知道应用怎么 bootstrap。
 * 变更**来源**由它自己向 `ClientAssets` 订阅（谁服务前端资产谁报"服务端源码变了"）。
 */
export const provideServerHmr = provide([ServerHmr]);
