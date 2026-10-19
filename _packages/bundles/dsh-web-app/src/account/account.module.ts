import { Module } from "@morlay/zephyr";
import { AccountController } from "./account.service.ts";

@Module({ providers: [AccountController] })
export class AccountModule {}
