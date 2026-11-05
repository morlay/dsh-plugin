// dev 形态的入口提示：打印 origin。
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
    this.logger.info("[web] %s", `${this.webServer.protocol}//${this.webServer.host}:${this.webServer.port}/`);
  }
}
