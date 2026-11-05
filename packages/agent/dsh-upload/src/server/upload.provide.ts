import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { FileUploadStoreDefault } from "../file-upload-store.service.ts";
import { FileUploadEndpoint } from "./file-upload-endpoint.ts";

export const provideUpload = provide([
  FileUploadStoreDefault,
  FileUploadEndpoint,
  remoteDescriptor(() => import("@deepseek-ai/dsh-client-file-upload/remote")),
]);
