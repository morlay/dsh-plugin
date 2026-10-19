import { Module } from "@morlay/zephyr";
import { UiMessageFeedback } from "./message.client.service.ts";

@Module({ providers: [UiMessageFeedback] })
export class MessageClientModule {}
