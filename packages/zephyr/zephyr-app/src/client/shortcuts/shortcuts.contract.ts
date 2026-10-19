// 快捷键命令契约（上游 `dsh-client-shortcuts` 的 `shortcuts` 服务）：layout 按名字读它。
import type { Shortcuts as ShortcutsFace } from "@deepseek-ai/dsh-client-shortcuts/client";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class Shortcuts {
  abstract readonly register: ShortcutsFace["register"];

  abstract readonly registerFixed: ShortcutsFace["registerFixed"];

  abstract readonly describeBinding: ShortcutsFace["describeBinding"];
}
