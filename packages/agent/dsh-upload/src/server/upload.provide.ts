import { provide } from "@morlay/zephyr";
import { FileUploadStoreDefault } from "../file-upload-store.service.ts";
import { FileUploadEndpoint } from "./file-upload-endpoint.ts";

export const provideUpload = provide([FileUploadStoreDefault, FileUploadEndpoint]);
