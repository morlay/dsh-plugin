import { Module } from "@morlay/zephyr";
import { UiInputTrigger } from "./input.client.service.ts";

@Module({ providers: [UiInputTrigger] })
export class InputClientModule {}
