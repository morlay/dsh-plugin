import TypertGatewayService from "@deepseek-ai/dsh-api-gateway";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertRegistry } from "@deepseek-ai/dsh-typert-registry";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { RemoteAccess } from "./remote-access.contract.ts";
import { Typert } from "./typert.contract.ts";
import { TypertGateway } from "./typert-gateway.contract.ts";

@Injectable()
export class TypertDefault extends fromCordis(Typert, TypertRegistry) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
