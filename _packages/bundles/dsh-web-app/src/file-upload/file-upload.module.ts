import { Module } from "@morlay/zephyr";
import { FileUploads } from "./file-upload.service.ts";

@Module({ providers: [FileUploads] })
export class FileUploadModule {}
