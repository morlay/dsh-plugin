import { Module } from "@morlay/zephyr";
import { UiCommands } from "./commands.client.service.ts";

@Module({ providers: [UiCommands] })
export class CommandsClientModule {}
