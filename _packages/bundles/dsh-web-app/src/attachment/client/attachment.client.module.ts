import { Module } from "@morlay/zephyr";
import { UiAttachment } from "./attachment.client.service.ts";

@Module({ providers: [UiAttachment] })
export class AttachmentClientModule {}
