// session-mode 的**测试装配清单**（本仓的装配方式：`bootstrapApplication` + `ProviderList`）。
//
// headless 一条：骨架 + 会话 + 投影 + 执行器 + 循环本体 + 通道/收口/工具说明/模式。
// **不装 wire**（端点行要 `remote-handlers`，headless 不依赖 remote）。
import {
  configure,
  without,
  type ProviderFeature,
  type ProviderEntry,
  type ProviderList,
} from "@morlay/zephyr";
import { loopTestProviders } from "@morlay/dsh-agent-loop/testing";
import { StorageJsonDefault, provideStorage, provideStorageJson } from "@morlay/dsh-storage";
import { StorageDomain } from "@morlay/dsh-storage/contract";
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
  /**
   * 存储域：`{ root }` 装真 json 后端 + 真域行（根目录在 `root/storages`）；
   * `{ domain }` 把域换成一个替身（写失败这类用例用它）。不写就是**没有存储域**（headless 形态）。
   */
  readonly storage?: { readonly root: string } | { readonly domain: object };
}

/**
 * 存储面的装配条目。
 * @param option - `storage` 选项。
 * @returns 条目清单；没有存储域时是空的。
 */
function storageProviders(option: SessionModeTestOptions["storage"]): ProviderEntry[] {
  if (option === undefined) return [];
  if ("domain" in option) {
    // 域令牌直接给一个值（替身，或外面已经起好的一套真栈的包装）：不装 hub、也不装真域行。
    return [{ provide: StorageDomain, useValue: option.domain }];
  }
  // 真后端：hub + 域行 + 上游 json 后端，根目录落在临时目录下（与装配面的顺序一致：后端在域行之后）。
  return [
    ...provideStorage(),
    ...provideStorageJson(configure(StorageJsonDefault, { root: `${option.root}/storages` })),
  ];
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
  // 存储域排在模式行之前装：`SessionModeDefault` 的 `inject.optional(StorageDomain)` 因此解析到真实现。
  return [
    ...base,
    ...replacement,
    ...storageProviders(options.storage),
    ...provideSessionMode(...features),
  ];
}
