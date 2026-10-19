// typert 类型图生成行（纯实现行，不声明契约）。
import * as TypertLoaderPlugin from "@deepseek-ai/dsh-typert-loader";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Typert } from "@morlay/dsh-base/typert";

@Injectable()
export class TypertLoader extends fromCordis(TypertLoaderPlugin) {
  typert = inject(Typert);

  loader = inject.optional(Loader);

  protected override async onInit(ctx: Context): Promise<void> {
    if (this.loader === undefined) return;
    await this.mount(ctx, { packages: [] });
  }
}
