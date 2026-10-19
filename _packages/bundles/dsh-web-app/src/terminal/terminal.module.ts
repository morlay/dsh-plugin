import { Module } from "@morlay/zephyr";
import { TerminalController } from "./terminal.service.ts";

@Module({ providers: [TerminalController] })
export class TerminalModule {}
