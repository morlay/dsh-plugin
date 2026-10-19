import { Module } from "@morlay/zephyr";
import { UiSession } from "./session.client.service.ts";

@Module({ providers: [UiSession] })
export class SessionClientModule {}
