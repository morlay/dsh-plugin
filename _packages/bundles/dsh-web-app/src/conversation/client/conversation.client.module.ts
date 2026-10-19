import { Module } from "@morlay/zephyr";
import { UiConversation } from "./conversation.client.service.ts";

@Module({ providers: [UiConversation] })
export class ConversationClientModule {}
