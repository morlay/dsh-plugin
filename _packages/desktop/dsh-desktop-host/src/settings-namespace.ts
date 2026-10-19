// 桌面形态的**账号面空壳**：本部署不要官方账号的用户界面，但那一行（`ui-settings-account`）同时是
// **settings namespace 的 owner**——它的 `apply` 只做两件不可省的事，我们只需第一件：
//
// ```ts
// ctx.inject(['settings'], (scope) => {
//   scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
// })
// ```
//
// 少了这个注册，前端的 settings 镜面拿不到名册（`describeFace.view === undefined`）→ 直接 failLoad，
// 整个设置页判 "settings are unavailable in this browser"，连 `/api/settings` 都不请求。
//
// 上游那一行还往页面注入 contact 配置（给它自己的账号页用），以及渲染设置页的账号页、侧栏账号菜单、
// 首次引导层——本部署都不需要，所以停掉上游那行、由这里顶上这个注册。
//
// 装配方式见 `../config/desktop.cordis.patch.yml` 的 `insert`（必须写在那份 overlay 里：写在 bundle
// 层的停用会被后来应用的层盖回去）。

import type { Context } from "@deepseek-ai/cordis";

export const name = "@morlay/dsh-desktop-host-settings-namespace";

/**
 * 注册 settings namespace（`auto: false` 表示这个 namespace 的界面由宿主自己安排，不走自动渲染）。
 * @param ctx - 宿主的上下文。
 */
export function apply(ctx: Context): void {
  ctx.inject(["settings"], (scope) => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber));
  });
}
