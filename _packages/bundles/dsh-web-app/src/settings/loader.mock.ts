// 官方 loader 的最小实现：`settings` / `config-editor` 按**原生名** `loader` 取它
// （`ctx.root.loader.await()`）。做成 Service 才会落根——用 InjectionToken 只在 zephyr 的令牌表里，
// 这些上游行读不到。
import { Service } from "@deepseek-ai/cordis";
import { Injectable } from "@morlay/zephyr";

type CordisContext = ConstructorParameters<typeof Service>[0];

@Injectable()
export class LoaderMock extends Service {
  static readonly packageName = "@morlay/dsh-web-app";

  constructor(ctx: CordisContext) {
    super(ctx, "loader");
  }

  /** 代码组合形态没有「装载阶段」，装配完成即视为落定。 */
  async await(): Promise<void> {
    return Promise.resolve();
  }

  /** 没有 loader 的条目表：配置编辑以 profile 的 patch 行面为准。 */
  entries(): Iterable<unknown> {
    return [];
  }
}
