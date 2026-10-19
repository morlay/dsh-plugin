import { provide, type ProviderList } from "@morlay/zephyr";
import { ToolGoal } from "./tool-goal.service.ts";
import { GoalDefault } from "../goal.service.ts";

// 状态机 + 它的工具行（`get_goal` / `create_goal` / `update_goal`）。
const providers = (): ProviderList => [GoalDefault, ToolGoal];

export const provideGoal = provide(providers());
