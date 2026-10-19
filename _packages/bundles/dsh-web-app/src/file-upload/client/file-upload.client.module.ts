import { Module } from "@morlay/zephyr";
import { FileUpload } from "./file-upload.client.service.ts";

@Module({ providers: [FileUpload] })
export class FileUploadClientModule {}
