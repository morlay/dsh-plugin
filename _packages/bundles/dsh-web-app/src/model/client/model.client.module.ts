import { Module } from "@morlay/zephyr";
import { UiModelSelection } from "./model.client.service.ts";

@Module({ providers: [UiModelSelection] })
export class ModelClientModule {}
