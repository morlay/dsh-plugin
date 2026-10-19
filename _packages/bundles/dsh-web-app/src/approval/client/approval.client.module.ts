import { Module } from "@morlay/zephyr";
import { UiApproval } from "./approval.client.service.ts";

@Module({ providers: [UiApproval] })
export class ApprovalClientModule {}
