// 文件观察策略（适配行，不声明契约：上游不提供对外服务）。
//
// 统一形态：所有上游实现都经 `fromCordis` 挂载——不在个别行上手写 `apply(ctx)`。
// 这一条没有契约（`apply` 只碰 `ctx.effect` / `ctx.on`，不发布服务），所以用单参形态，
// 并按约定自己写 `onInit` 调 `mount`（没有契约就没有 autoMount）。
import * as FsObservationPolicyPlugin from "@deepseek-ai/dsh-fs-observation-policy";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class FsObservationPolicy extends fromCordis(FsObservationPolicyPlugin) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
