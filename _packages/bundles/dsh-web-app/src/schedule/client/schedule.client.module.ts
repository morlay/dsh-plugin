import { Module } from "@morlay/zephyr";
import { UiSchedule } from "./schedule.client.service.ts";

@Module({ providers: [UiSchedule] })
export class ScheduleClientModule {}
