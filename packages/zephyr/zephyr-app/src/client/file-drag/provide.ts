import { provide } from "@morlay/zephyr";
import { FileDragDefault } from "./file-drag.service.ts";

export const provideFileDrag = provide([FileDragDefault]);
