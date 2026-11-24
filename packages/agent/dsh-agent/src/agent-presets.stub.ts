// 部署级 **agent preset roster** 的最小实现：让 0.2.3 的会话创建认得 `ptc` 这份预设。
//
// 上游 `session-controller` 的 `assertPresetApplicable` 只有在 `ctx.get('agentPresets') === undefined`
// 且请求里带了 `agentPreset` 时才抛 `agent-preset/conflict`（"the deployment composes no agent preset
// roster…"）——浏览器半创建会话总会带这份 id（`DEFAULT_PRESET`），于是部署必须有一个 roster。
//
// 本部署的装配是**固定的一份行清单**，没有多 preset 选择面（见 `@morlay/session-mode` 的同名投影），
// 所以这里只登记那一个 id：不引上游 `agent-preset-registry`（它整套靠 `loader` 按 preset 装载
// cordis 条目，我们没有 Loader 那一层）。
import { Injectable } from "@morlay/zephyr";

/** roster 里的一行（与上游 `AgentPreset` 的读取面同形）。 */
export interface AgentPresetRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isDefault: boolean;
}

/** 本部署唯一的 preset id（与 `@morlay/session-mode` 的 `DEFAULT_PRESET` 一致）。 */
export const DEPLOYMENT_PRESET_ID = "ptc";

/**
 * 最小 agent preset roster。
 *
 * 服务名就是上游名 `agentPresets`：`session-controller` 的冲突判定按它是否存在，浏览器 roster 面按它列行。
 */
@Injectable({ name: "agentPresets" })
export class AgentPresetsStub {
  /** 后续新建会话的默认 preset。 */
  readonly defaultId: string = DEPLOYMENT_PRESET_ID;

  /**
   * 列出现有 preset（本部署只有一个）。
   * @returns roster 行。
   */
  async list(): Promise<AgentPresetRow[]> {
    return [
      {
        id: DEPLOYMENT_PRESET_ID,
        name: "PTC",
        description: "本部署固定的一份行清单",
        isDefault: true,
      },
    ];
  }

  /**
   * 浏览器 roster 面读的那份（remote 方法 `agentPresets/list`）。
   * @returns roster。
   */
  async remoteExportList(): Promise<{ presets: AgentPresetRow[] }> {
    return { presets: await this.list() };
  }

  /**
   * 按 preset 作用域解析一个服务（上游 `agentPresets` 契约的成员）。
   *
   * 本部署只有一份固定行清单，没有 per-preset 的作用域；上游 `skills/list` 等消费方按契约调用它，
   * 这里明确回答「没有作用域覆盖」——返回 `undefined` 即表示用装配全局的那一份。
   * @returns 永远 `undefined`。
   */
  serviceFor(): undefined {
    return undefined;
  }

  /**
   * 某个会话跑的 preset（会话 header 里记的那一份，缺省是本部署的那一个）。
   * @param session - 目标会话。
   * @returns preset id。
   */
  presetForSession(session: { readonly header?: { readonly agentPreset?: string } }): string {
    return session.header?.agentPreset ?? DEPLOYMENT_PRESET_ID;
  }

  /**
   * 解析一个 preset id。本部署不按 preset 换行清单，只校验 id。
   * @param id - preset id（缺省取默认）。
   * @returns roster 行。
   */
  async resolve(id: string = DEPLOYMENT_PRESET_ID): Promise<AgentPresetRow> {
    const rows = await this.list();
    const found = rows.find((row) => row.id === id);
    if (found === undefined) throw new Error(`未知的 agent preset：${id}`);
    return found;
  }

  /**
   * 把一个 preset 装到某条 agent 链上。本部署的行清单是**固定装配**，没有按 preset 追加的条目，
   * 所以这里只把 id 记下来并原样返回（`session-controller` 只 `await` 它、不用返回值）。
   * @param _ctx - 目标 agent 链的 ctx。
   * @param id - preset id（缺省取默认）。
   * @returns 那一个 preset。
   */
  async mount(_ctx: unknown, id?: string): Promise<AgentPresetRow> {
    return await this.resolve(id);
  }

  /**
   * 切换某个 agent 的 preset。本部署只有一份行清单，切换没有意义。
   * @param _agent - 目标 agent。
   * @param id - 目标 preset id。
   * @returns 不会返回：本部署不支持切换。
   */
  async select(_agent: unknown, id: string): Promise<string> {
    throw new Error(`本部署不支持切换 agent preset（请求的是 ${id}）`);
  }

  /**
   * 某条链当前挂的 preset id（上游子代理派生时读它继承父链的 preset）。
   * @param _ctx - 目标 ctx。
   * @returns 本部署唯一的那一个 id。
   */
  composedPreset(_ctx: unknown): string | undefined {
    return DEPLOYMENT_PRESET_ID;
  }

  /**
   * 子链继承哪份 preset（上游 `applyChildComposition` 用）。
   * @param _ctx - 子链 ctx。
   * @param _parent - 父链 ctx。
   * @returns 继承到的 preset id。
   */
  composeFrom(_ctx: unknown, _parent: unknown): string | undefined {
    return DEPLOYMENT_PRESET_ID;
  }

  /**
   * 取一个 preset 的作用域键（`skill-catalog` 用它隔离各 preset 的目录）。
   * @param _id - preset id（缺省取默认）。
   * @returns 作用域句柄：`key` 是键、`[Symbol.asyncDispose]` 是释放。
   */
  async acquireScope(_id?: string): Promise<{ key: object } & AsyncDisposable> {
    return {
      key: {},
      [Symbol.asyncDispose]: async () => {},
    };
  }
}
