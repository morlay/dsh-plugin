import { provide } from "@morlay/zephyr";
import { ShortcutsDefault } from "./shortcuts.service.ts";

export const provideShortcuts = provide([ShortcutsDefault]);
