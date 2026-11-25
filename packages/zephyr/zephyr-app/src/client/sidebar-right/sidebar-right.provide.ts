// 右栏这条链的装配清单：类型注册表 + 动作面实现 + 座位（都由本包出，不再装上游右栏行）。
//
// 上游那个插件的 `apply` 会把注册表和控制器 `reflect.provide` 出来，并在同一处注册座位；
// 我们只要它的两个工厂（`SidebarRightTabRegistry` / `createSidebarRightController`），
// 座位由自己的 `zephyr-ui` 组件顶（槽位名沿用上游，上游行的正文才进得来）。
import { provide } from "@morlay/zephyr";
import { SidebarRightDefault } from "./controller.service.ts";
import { GuideType } from "./guide.service.ts";
import { SidebarRightTabsDefault } from "./tabs.service.ts";

/**
 * 右栏的行清单。
 * @returns provider 清单（类型注册表在前：控制器要拿它的 `face`）。
 */
export const provideSidebarRight = provide([SidebarRightTabsDefault, SidebarRightDefault, GuideType]);
