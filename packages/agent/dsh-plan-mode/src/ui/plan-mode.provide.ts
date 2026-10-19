import { provide } from "@morlay/zephyr";
import { PlanSlots } from "./plan-slots.ts";

/** plan-mode 的浏览器半：计划事件与侧栏的 plan 标签页。 */
export const providePlanModeUi = provide([PlanSlots]);
