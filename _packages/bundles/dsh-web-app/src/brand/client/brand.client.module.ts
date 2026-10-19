import { Module } from "@morlay/zephyr";
import { UiBrandOfficial } from "./brand.client.service.ts";

@Module({ providers: [UiBrandOfficial] })
export class BrandClientModule {}
