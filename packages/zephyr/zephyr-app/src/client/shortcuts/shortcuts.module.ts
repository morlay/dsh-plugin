import { Module } from "@morlay/zephyr";
import { ShortcutsDefault } from "./shortcuts.service.ts";

@Module({ providers: [ShortcutsDefault] })
export class ShortcutsModule {}
