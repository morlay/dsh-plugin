// API gateway：上游 `TypertGatewayService` 经 `fromCordis` 接管。
import TypertGatewayService from "@deepseek-ai/dsh-api-gateway";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { RemoteAccess } from "./remote-access.contract.ts";
import { Typert } from "./typert.contract.ts";
import { TypertGateway } from "./typert-gateway.contract.ts";

@Injectable()
export class TypertGatewayDefault extends fromCordis(TypertGateway, TypertGatewayService) {
  typert = inject(Typert);

  remoteAccess = inject(RemoteAccess);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      typert: this.typert,
      remoteAccess: this.remoteAccess,
    });
  }
}
