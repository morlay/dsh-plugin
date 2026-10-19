import { Module } from "@morlay/zephyr";
import { LaunchEnvironmentDefault } from "./launch-environment.service.ts";

@Module({ providers: [LaunchEnvironmentDefault] })
export class LaunchEnvironmentModule {}
