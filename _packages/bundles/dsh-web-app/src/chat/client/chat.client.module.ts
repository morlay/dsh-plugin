import { Module } from "@morlay/zephyr";
import { UiChat } from "./chat.client.service.ts";

@Module({ providers: [UiChat] })
export class ChatClientModule {}
