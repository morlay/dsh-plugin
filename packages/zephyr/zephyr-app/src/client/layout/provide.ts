import { provide } from "@morlay/zephyr";
import { LayoutDefault } from "./layout.service.ts";

export const provideLayout = provide([LayoutDefault]);
