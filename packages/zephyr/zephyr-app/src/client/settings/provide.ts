import { provide } from "@morlay/zephyr";
import { ConfigFormsDefault } from "./config-forms.service.ts";

export const provideConfigForms = provide([ConfigFormsDefault]);
