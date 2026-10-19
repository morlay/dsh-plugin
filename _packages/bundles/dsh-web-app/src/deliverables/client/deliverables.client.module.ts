import { Module } from "@morlay/zephyr";
import { UiDeliverables } from "./deliverables.client.service.ts";

@Module({ providers: [UiDeliverables] })
export class DeliverablesClientModule {}
