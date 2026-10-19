import { Module } from "@morlay/zephyr";
import { FileReferenceLocal } from "./reference.service.ts";

@Module({ providers: [FileReferenceLocal] })
export class ReferenceModule {}
