import { Module } from "@morlay/zephyr";
import { SessionScopeDefault } from "./session-scope.service.ts";
import { SlotsDefault } from "./slots.service.ts";
import { UiRendererDefault } from "./ui-renderer.service.ts";

/** 渲染面：槽注册表（复用上游 `SlotRegistry`）+ 应用挂载（自实现）。 */
@Module({ providers: [SlotsDefault, SessionScopeDefault, UiRendererDefault] })
export class RendererModule {}
