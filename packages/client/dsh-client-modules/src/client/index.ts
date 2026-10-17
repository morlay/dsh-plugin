// client 半：**只把上游 `modules` 服务面补上**，别的什么都不做。
//
// 为什么需要它：上游 `ui-settings-general` 的 client 插件从 0.2.x 起 inject `modules`，并真的用两个成员
// （`entries.releaseChange` 是 Host release 变更提示的数据源、`entries.dismissRelease` 记下"已读"）。
// 我们的装配停用了上游 `client-modules` 行——它的宿主半提供模块表 roster、`/plugins` 路由与 boot 注入，
// 页面与资源改由本包的宿主半（vite dev server）提供——于是在浏览器侧**没有**这个服务，那一行永远等不到
// inject 满足、`apply` 不执行，`sidebar.settings` 槽没有占位者，侧栏左下角的设置入口整个消失。
//
// 最小实现的口径：本链没有"模块表条目"这回事，所以
// · `releaseChange` 恒 `undefined`（没有跨 Host 版本的插件更新要提示），
// · `dismissRelease()` 空操作（提示不出现，也没有"已读"要记），
// · `invalidate(id)` 空操作（上游动态插件运行器用它做模块失效；它下一步就去要 `__ModuleLoader__` 模块表，
//   在我们这里会自己报缺 sink——错误信息比"不是函数"清楚得多）。
import type { Context } from "@deepseek-ai/cordis";

/** 恒 `undefined` 的可订阅快照（`useSyncExternalStore` 的入参形状）。 */
const NO_RELEASE_CHANGE = {
  getSnapshot: (): undefined => undefined,
  subscribe: () => () => {},
};

/**
 * 发布 `modules` 服务（上游同名的服务面，见文件头）。
 *
 * @param ctx - 浏览器侧根上下文。
 */
export function apply(ctx: Context): void {
  ctx.reflect.provide("modules", {
    entries: {
      releaseChange: NO_RELEASE_CHANGE,
      dismissRelease: () => {},
    },
    invalidate: () => {},
  });
}
