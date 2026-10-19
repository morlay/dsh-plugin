import { provide } from "@morlay/zephyr";
import { LocaleDefault } from "./locale.service.ts";

export const provideLocale = provide([LocaleDefault]);
