// 主题契约（上游 `dsh-client-ui-theme` 的 `theme` 服务）：layout 按名字读它。
import type { ThemeRuntime } from "@deepseek-ai/dsh-client-ui-theme/client";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class Theme {
  abstract readonly getTheme: ThemeRuntime["getTheme"];

  abstract readonly setTheme: ThemeRuntime["setTheme"];

  abstract readonly register: ThemeRuntime["register"];
}
