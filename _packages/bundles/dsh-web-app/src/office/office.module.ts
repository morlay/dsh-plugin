import { Module } from "@morlay/zephyr";
import { OfficeToPdf } from "./office.service.ts";

@Module({ providers: [OfficeToPdf] })
export class OfficeModule {}
