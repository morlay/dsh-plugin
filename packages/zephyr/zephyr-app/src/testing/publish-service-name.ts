// 把某个契约实例按**上游服务名**发布到根 cordis store（只给测试用）。
//
// 上游插件按 `ctx.<camelName>` **严格读**（`this.ctx.remoteAccess` 这类）。产品侧这个名字由上游自己的
// `super(ctx, 'remoteAccess')` 注册；而 spec 里常用替身替换那一行，替身不走 `super`，名字就不在 store 里，
// 上游读到 `undefined` 才在调用点上炸（`Cannot read properties of undefined (reading 'allows')`）。
//
// 用法：
//
//   { provide: RemoteAccess, useFactory: () => allowAllAccess() },
//   publishingTo(RemoteAccess, "remoteAccess"),
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";

/**
 * 造一个「把契约实例发布成上游名字」的 provider。
 * @param contract - 契约类（或令牌）。
 * @param name - 上游的服务名（驼峰）。
 * @returns 可放进清单的 provider 类。
 */
export function publishingTo(contract: object, name: string): new () => OnInit {
  @Injectable()
  class ServiceNamePublisher implements OnInit {
    private readonly value = inject(contract as never);

    onInit(ctx: Context): void {
      (ctx as unknown as { root: { provide(key: string, impl: unknown): void } }).root.provide(
        name,
        this.value,
      );
    }
  }
  return ServiceNamePublisher;
}
