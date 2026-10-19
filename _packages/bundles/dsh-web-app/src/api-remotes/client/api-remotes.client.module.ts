import { Module } from "@morlay/zephyr";
import { ApiRemotes } from "./api-remotes.client.service.ts";

@Module({ providers: [ApiRemotes] })
export class ApiRemotesClientModule {}
