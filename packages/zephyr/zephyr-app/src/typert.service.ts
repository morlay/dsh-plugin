import TypertRegistryPlugin from "@deepseek-ai/dsh-typert-registry";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Typert } from "./typert.contract.ts";

@Injectable()
export class TypertDefault extends fromCordis(Typert, TypertRegistryPlugin) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
