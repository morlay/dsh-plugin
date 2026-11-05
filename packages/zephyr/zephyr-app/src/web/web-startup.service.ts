// 默认启动值：环境变量 + 默认（127.0.0.1:3080）。
import { Injectable } from "@morlay/zephyr";
import { WebStartup, type WebStartupValues } from "./web-startup.contract.ts";

@Injectable()
export class WebStartupDefault extends WebStartup {
  readonly values: WebStartupValues = {
    trustedHosts: [],
    host: process.env.HOST ?? "127.0.0.1",
    port: process.env.PORT === undefined ? 3080 : Number(process.env.PORT),
  };
}
