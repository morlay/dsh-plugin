import { provide } from "@morlay/zephyr";
import { ViteHandoffDefault } from "./vite-handoff.service.ts";

export const provideViteHandoff = provide([ViteHandoffDefault]);
