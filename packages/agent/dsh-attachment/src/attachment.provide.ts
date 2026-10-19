import { configure, provide } from "@morlay/zephyr";
import { AttachmentStoreDefault } from "./attachment-store.service.ts";

/** 附件后端配置：`dshHome` 省略时跟随 `$DSH_HOME`，再回落到 `~/.dsh`（上游的解析顺序）。 */
export interface AttachmentConfig {
  readonly dshHome: string;
}

/**
 * 附件后端：不给配置就跟随 `$DSH_HOME` / `~/.dsh`。
 *
 * 装配面要指定：`provideAttachment(configure(AttachmentStoreDefault, { dshHome }))`。
 */
export const provideAttachment = provide([AttachmentStoreDefault]);
