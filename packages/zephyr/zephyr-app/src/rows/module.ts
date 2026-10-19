import { Module } from "@morlay/zephyr";
import { ClientRowsDefault } from "./client-rows.service.ts";

/** 行清单的装配面：值由装配方经 `configuredProvider(ClientRowsDefault, rows)` 给。 */
@Module({ providers: [ClientRowsDefault] })
export class RowsModule {}
