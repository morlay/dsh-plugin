import { Module } from "@morlay/zephyr";
import { UiPlan } from "./plan.client.service.ts";

@Module({ providers: [UiPlan] })
export class PlanClientModule {}
