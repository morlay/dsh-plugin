import { Module } from "@morlay/zephyr";
import { UiGoal } from "./goal.client.service.ts";

@Module({ providers: [UiGoal] })
export class GoalClientModule {}
