import { provide } from "@morlay/zephyr";
import { ServerHmr } from "../internal/server-hmr.ts";

/**
 * 开发态的**服务端 HMR**。
 *
 * 只有装配面显式装它才有：生产形态不需要（那时源码不变），测试也不需要（会拖长拆卸）。
 * 装完还要由入口 `install({ reload, isIdle })`——`zephyr-app` 不知道应用怎么 bootstrap。
 */
export const provideServerHmr = provide([ServerHmr]);
