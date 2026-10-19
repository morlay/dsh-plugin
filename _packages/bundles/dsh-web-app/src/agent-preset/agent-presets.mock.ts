// `agentPresets` 的**最小 mock**：本形态没有 preset 的编辑/切换需求，恒为 `standard`。
// 上游 registry 依赖 `agentPresets` 自身与 loader/sessionProjections，装它只会把装配拖住；
// 会话侧只用到 `resolve` / `mount` / `select` 三个方法（见 api/session-controller 的 agent.ts）。
import { Service } from "@deepseek-ai/cordis";
import { Injectable } from "@morlay/zephyr";

type CordisContext = ConstructorParameters<typeof Service>[0];

export interface StandardPreset {
  readonly id: string;
  readonly name: string;
}

/** 固定返回 `standard` 的预设目录。 */
@Injectable()
export class AgentPresetsMock extends Service {
  // 行名按包名生成：`@Injectable()` 在打包产物里的定义文件可能落在包外，这里显式声明。
  static readonly packageName = "@morlay/dsh-web-app";

  static readonly defaultPreset: StandardPreset = { id: "standard", name: "Standard" };

  constructor(ctx: CordisContext) {
    super(ctx, "agentPresets");
  }

  get defaultId(): string {
    return AgentPresetsMock.defaultPreset.id;
  }

  async resolve(presetId?: string): Promise<StandardPreset> {
    return presetId === undefined || presetId === "standard"
      ? AgentPresetsMock.defaultPreset
      : AgentPresetsMock.defaultPreset;
  }

  async mount(_agentCtx: CordisContext, _presetId: string): Promise<void> {
    /* 没有要装的插件：标准装配由入口 Module 提供。 */
  }

  async select(): Promise<void> {
    /* 不支持切换：恒为 standard。 */
  }

  /** preset 作用域里的服务：没有 preset 行，调用方回退到全局注册表（`ctx.get(name)`）。 */
  serviceFor(): undefined {
    return undefined;
  }

  /** 没有 preset 作用域可租（调用方同样回退到全局）。 */
  async acquireScope(): Promise<undefined> {
    return undefined;
  }
}
