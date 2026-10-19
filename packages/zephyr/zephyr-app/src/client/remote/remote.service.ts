import * as RemotePlugin from "@deepseek-ai/dsh-api-gateway/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Connection } from "../../connection/contract.ts";
import { Typert } from "../../typert.contract.ts";
import { Remote } from "../../remote.contract.ts";

// 上游 `inject: ['typert','connection']` 并**按 ctx 读**（`ctx.get('connection')` 后直接用
// `interactions`/`openWebSocket`/`rpc`/`start`）：显式把契约面传进 deps，落进行内 local，
// 上游 `lookup` 第一层就命中，不依赖根名字视图。
@Injectable()
export class RemoteDefault extends fromCordis(Remote, RemotePlugin) {
  private readonly typert = inject(Typert);

  private readonly connection = inject(Connection);

  protected async onInit(ctx: Context): Promise<void> {
    // 装配断言（不是调试探针）：上游在构造里直接读 `connection.rpc`/`interactions`，
    // 面缺成员时在这里指名道姓地报错，而不是等上游抛一句 reading 'open'。
    const face = this.connection as unknown as Record<string, unknown>;
    if (face["rpc"] === undefined || face["interactions"] === undefined) {
      throw new Error(
        `RemoteDefault: Connection 面不可用（ctor=Connection<${(this.connection as { constructor?: { name?: string } }).constructor?.name}> keys=${Object.keys(face).join(",")}）`,
      );
    }
    await this.mount(ctx, undefined, { typert: this.typert, connection: this.connection });
  }
}
