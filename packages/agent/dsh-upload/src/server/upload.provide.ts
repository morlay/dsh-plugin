import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { FileUploadStoreDefault } from "../file-upload-store.service.ts";
import { FileUploadEndpointRow } from "./file-upload-endpoint.ts";

export const provideUpload = provide([
  FileUploadStoreDefault,
  FileUploadEndpointRow,
  remoteDescriptor(() => import("@deepseek-ai/dsh-client-file-upload/remote")),
]);
