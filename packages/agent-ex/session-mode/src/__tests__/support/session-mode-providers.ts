// session-mode 的**测试装配清单**（本仓的装配方式：`bootstrapApplication` + `ProviderList`）。
//
// headless 一条：骨架 + 会话 + 投影 + 执行器 + 循环本体 + 通道/收口/工具说明/模式。
// **不装 wire**（端点行要 `remote-handlers`，headless 不依赖 remote）。
import { configure, without, type ProviderFeature, type ProviderList } from "@morlay/zephyr";
import { loopTestProviders } from "@morlay/dsh-agent-loop/testing";
import { provideSessionMode } from "../../session-mode.provide.ts";
import { ContextChannel } from "../../context-assembler.provide.ts";
import { ContextAssemblerDefault } from "../../context-assembler.service.ts";
import { ToolGuidance } from "../../tool-guidance.service.ts";
import { SessionModeDefault } from "../../session-mode.service.ts";

/** 测试装配的选项（都可省）。 */
export interface SessionModeTestOptions {
  /** 通道配置（`keep` / `suppress` / `replace`）；`false` 表示不装通道那一行。 */
  readonly channel?: Record<string, unknown> | false;
  /** 工具说明的配置；`false` 表示不装那一行。 */
  readonly guidance?: Record<string, unknown> | false;
  /** 模式本体的配置；`false` 表示不装那一行。 */
  readonly modes?: Record<string, unknown> | false;
  /** 通道本体：`false` 表示不装，也可以给一个自己的实现类替掉默认那份（spec 用记录器时）。 */
  readonly assembler?: false | (new () => unknown);
  /** 提示词配置（透传给 `SystemPromptDefault`）。 */
  readonly systemPrompt?: Record<string, unknown>;
}

/**
 * headless 层的测试装配清单。
 * @param options - 通道 / 工具说明 / 提示词的覆盖。
 * @returns 条目清单。
 */
export function sessionModeTestProviders(options: SessionModeTestOptions = {}): ProviderList {
  const base = loopTestProviders(
    options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt },
  );
  // 通道与工具说明都在 `provideSessionMode()` 的清单里：用 `configure` 覆盖、`without` 剔除，
  // 不能再各装一份（同一服务注册两次会抛 `has been registered`）。
  const features: ProviderFeature[] = [
    ...(options.assembler === false
      ? [without(ContextAssemblerDefault)]
      : options.assembler === undefined
        ? []
        : [without(ContextAssemblerDefault)]),
    options.channel === false
      ? without(ContextChannel)
      : configure(ContextChannel, (options.channel ?? {}) as never),
    options.guidance === false
      ? without(ToolGuidance)
      : configure(ToolGuidance, (options.guidance ?? {}) as never),
    options.modes === false
      ? without(SessionModeDefault)
      : configure(SessionModeDefault, (options.modes ?? {}) as never),
  ];
  // `provideSessionMode` 本身就是 `provide(list, defaults)` 的产物：features 直接传给它，
  // 不要在外面再包一层 provide（否则服务会被注册两次）。
  const replacement =
    options.assembler === undefined || options.assembler === false ? [] : [options.assembler];
  return [...base, ...replacement, ...provideSessionMode(...features)];
}
