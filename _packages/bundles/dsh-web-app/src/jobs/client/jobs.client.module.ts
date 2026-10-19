import { Module } from "@morlay/zephyr";
import { UiJobs } from "./jobs.client.service.ts";

@Module({ providers: [UiJobs] })
export class JobsClientModule {}
