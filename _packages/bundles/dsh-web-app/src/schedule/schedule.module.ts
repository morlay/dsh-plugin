import { Module } from "@morlay/zephyr";
import { Schedule } from "./schedule.service.ts";

@Module({ providers: [Schedule] })
export class ScheduleModule {}
