// 把**浏览器面**的连接按上游名 `connection` 发布（测试装配用）。
//
// 真实部署里浏览器进程只有这一面，所以上游浏览器行（`ui-workspace` / `ClientRemoteService`）按
// `ctx.connection` 严格读它。本仓的混合装配（宿主面也在同一个 app 里）不真实，因此：
// 名字已被占（宿主面在场）时让位，不覆盖。
import { inject, Injectable, rootContextKey, type Context, type OnInit } from "@morlay/zephyr";
import { ClientConnection } from "@morlay/zephyr-app/contract";

/** 把 `ClientConnection` 按名字 `connection` 发布成上游能严格读到的服务。 */
@Injectable()
export class PublishBrowserConnectionName implements OnInit {
  private readonly connection = inject(ClientConnection);

  onInit(ctx: Context): void {
    if (ctx.get("connection", false) !== undefined) return;
    ctx[rootContextKey].provide("connection", this.connection);
  }
}
