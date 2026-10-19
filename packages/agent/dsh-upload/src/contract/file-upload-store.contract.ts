// `fileUploads`：浏览器上传的宿主服务面（上游 `FileUploads` 经 `fromCordis` 接管）。
import type { FileUploads } from "@deepseek-ai/dsh-client-file-upload";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `FileUploads` 的**全部**公开成员。
 *
 * 上游 `session-controller` 的 `inject` 里就叫 `fileUploads`，装配面把我们这一行的实例交给它；
 * 上传入口（`upload` / `uploadStream`）与 `typertRemote` 同样是上游真面的一部分，一并投影，
 * 否则按名字取用的插件拿到的是 `undefined`。下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type FileUploadStoreCovered = AssertTrue<
  AssertCovered<FileUploads, FileUploadStore>
>;

@Injectable()
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
