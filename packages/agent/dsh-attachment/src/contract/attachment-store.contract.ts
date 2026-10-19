// 附件存储契约：令牌按服务语义命名（上游注册名 `attachments`）。
import type AttachmentStoreService from "@deepseek-ai/dsh-attachment";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `AttachmentStore` 的**全部**公开成员（文件与图片两半）。
 *
 * 上游插件按 `ctx.attachments.<member>` 取用，缺一个那条插件在运行期读到的就是 `undefined`——
 * 图片那一半本装配暂时没有消费方，但上游插件（`session-controller` 的图片准入）会按名字取，
 * 所以一并投影；下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type AttachmentsCovered = AssertTrue<
  AssertCovered<AttachmentStoreService, AttachmentStore>
>;

@Injectable()
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

