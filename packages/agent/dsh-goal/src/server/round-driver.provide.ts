import { provide } from "@morlay/zephyr";
import { GoalRoundDriver } from "../round-driver.service.ts";

export const provideGoalRoundDriver = provide([GoalRoundDriver]);
