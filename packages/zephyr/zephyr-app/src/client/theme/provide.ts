import { provide } from "@morlay/zephyr";
import { ThemeDefault } from "./theme.service.ts";

export const provideTheme = provide([ThemeDefault]);
