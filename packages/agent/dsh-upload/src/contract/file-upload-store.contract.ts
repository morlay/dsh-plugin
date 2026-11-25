// `fileUploads`：浏览器上传的宿主服务面（上游 `FileUploads` 经 `fromCordis` 接管）。
import type { FileUploads } from "@deepseek-ai/dsh-client-file-upload";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

@Injectable({ name: "fileUploads" })
export abstract class FileUploadStore {
  abstract readonly registerAgentResolver: FileUploads["registerAgentResolver"];

  abstract readonly resolve: FileUploads["resolve"];

  abstract readonly bindPrompt: FileUploads["bindPrompt"];

  abstract readonly retirePrompt: FileUploads["retirePrompt"];

  abstract readonly upload: FileUploads["upload"];

  abstract readonly uploadStream: FileUploads["uploadStream"];

  abstract readonly typertRemote: FileUploads["typertRemote"];

  abstract readonly uploadImageStream: FileUploads["uploadImageStream"];
}

/**
 * 覆盖守卫（严格）：上游 `FileUploads` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type FileUploadStoreCovered = AssertTrue<AssertCoveredStrict<FileUploads, FileUploadStore>>;
