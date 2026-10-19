import { provide, type ProviderList } from "@morlay/zephyr";
import { FileUploadStoreDefault } from "../file-upload-store.service.ts";
import { FileUploadEndpoint } from "./file-upload-endpoint.ts";

const providers = (): ProviderList => [FileUploadStoreDefault, FileUploadEndpoint];

export const provideUpload = provide(providers());
