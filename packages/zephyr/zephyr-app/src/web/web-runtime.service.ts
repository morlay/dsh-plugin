// 装了 `provideWeb()` 的形态（preview / 打包）在装配时打一眼 origin。
//
// **dev 不走这里**：`zephyr dev` 的装配里没有 `provideWeb()`（它自己的行在 `@morlay/zephyr-dev`），
// dev 的访问地址由 `startDev` 报——起会话的那一处才知道端口（端口被占时会顺延）。
//
// 路由表由**注册它的那一行**（`ClientModulesDefault`）在装配收尾打印——`WebRuntimeService` 跑在前面，
// 那时表还是空的（一个事实一个 home：谁注册谁报告）。
import { inject, Injectable, Logger, type OnInit } from "@morlay/zephyr";
import { WebServer } from "./web-server.contract.ts";

@Injectable()
export class WebRuntimeService implements OnInit {
  private readonly webServer = inject(WebServer);

  private readonly logger = inject(Logger);

  onInit(): void {
    this.logger.info(
      "[web] %s",
      `${this.webServer.protocol}//${this.webServer.host}:${this.webServer.port}/`,
    );
  }
}
