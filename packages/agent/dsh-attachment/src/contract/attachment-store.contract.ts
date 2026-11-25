// 附件存储契约：令牌按服务语义命名（上游注册名 `attachments`）。
import type AttachmentStoreService from "@deepseek-ai/dsh-attachment";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

@Injectable({ name: "attachments" })
export abstract class AttachmentStore {
  abstract readonly saveFile: AttachmentStoreService["saveFile"];

  abstract readonly readFileStream: AttachmentStoreService["readFileStream"];

  abstract readonly fileHostPath: AttachmentStoreService["fileHostPath"];

  abstract readonly admitEncodedFile: AttachmentStoreService["admitEncodedFile"];

  abstract readonly admitPromptContent: AttachmentStoreService["admitPromptContent"];

  abstract readonly imageHostPath: AttachmentStoreService["imageHostPath"];

  abstract readonly imageLimits: AttachmentStoreService["imageLimits"];

  abstract readonly isAttachmentError: AttachmentStoreService["isAttachmentError"];

  abstract readonly readImage: AttachmentStoreService["readImage"];

  abstract readonly readImageRequest: AttachmentStoreService["readImageRequest"];

  abstract readonly saveFileStream: AttachmentStoreService["saveFileStream"];

  abstract readonly saveImage: AttachmentStoreService["saveImage"];

  abstract readonly saveImages: AttachmentStoreService["saveImages"];

  abstract readonly validateImage: AttachmentStoreService["validateImage"];
}

/**
 * 覆盖守卫（严格）：上游 `AttachmentStoreService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type AttachmentStoreCovered = AssertTrue<AssertCoveredStrict<AttachmentStoreService, AttachmentStore>>;
