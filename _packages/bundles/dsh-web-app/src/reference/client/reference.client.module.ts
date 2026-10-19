import { Module } from "@morlay/zephyr";
import { UiReference } from "./reference.client.service.ts";

@Module({ providers: [UiReference] })
export class ReferenceClientModule {}
