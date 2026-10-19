import { Module } from "@morlay/zephyr";
import { Shortcuts, UiShortcuts } from "./shortcuts.client.service.ts";

@Module({ providers: [Shortcuts, UiShortcuts] })
export class ShortcutsClientModule {}
