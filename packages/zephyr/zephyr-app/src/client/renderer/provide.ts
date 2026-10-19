import { provide } from "@morlay/zephyr";
import { SlotsDefault } from "./slots.service.ts";
import { UiRendererDefault } from "./ui-renderer.service.ts";

/**
 * 渲染面：槽注册表（复用上游 `SlotRegistry`）+ 应用挂载（自实现）。
 *
 * `session` scope 的 adapter 由**业务行**提供（`ui-session`）；测试夹具自己装空的。
 */
export const provideRenderer = provide([SlotsDefault, UiRendererDefault]);
