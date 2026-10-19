import { Module } from "@morlay/zephyr";
import { JobController } from "./jobs.service.ts";

@Module({ providers: [JobController] })
export class JobsModule {}
