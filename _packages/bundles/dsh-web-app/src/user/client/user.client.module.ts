import { Module } from "@morlay/zephyr";
import { UiUserQuestions } from "./user.client.service.ts";

@Module({ providers: [UiUserQuestions] })
export class UserClientModule {}
