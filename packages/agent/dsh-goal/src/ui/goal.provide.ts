import { provide } from "@morlay/zephyr";
import { GoalSlots } from "./goal-slots.ts";

/** goal 的浏览器半：会话内卡片与侧栏的 goal 标签页。 */
export const provideGoalUi = provide([GoalSlots]);
