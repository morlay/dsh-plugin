import { provide } from "@morlay/zephyr";
import { ClientRowsDefault } from "./rows.service.ts";

/** 行清单的装配面：值由装配方经 `configure(ClientRowsDefault, rows)` 给。 */
export const provideRows = provide([ClientRowsDefault]);
