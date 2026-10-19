import { Module } from "@morlay/zephyr";
import { HarnessDevContext } from "./dev-context.service.ts";

@Module({ providers: [HarnessDevContext] })
export class DevContextModule {}
