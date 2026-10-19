import { Module } from "@morlay/zephyr";
import { UiSecretMask } from "./secret.client.service.ts";

@Module({ providers: [UiSecretMask] })
export class SecretClientModule {}
