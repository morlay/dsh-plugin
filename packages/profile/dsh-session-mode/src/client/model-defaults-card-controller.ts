/**
 * 设置页那张卡片（Plugins 列表里的「会话模式」）的控制器：编辑 config 顶层的 `models`（模式 id → 模型）。
 *
 * 为什么不用 `@morlay/dsh-client-ui-primitives/client` 的 `SettingsFormModel`：那个模型是**标量字段**表
 * —一个字段名一份文本草稿。这里的编辑面是一张**动态映射**（每行一个模式，值是一个三元组），要套进去就得
 * 把模型编码成文本再解回来。所以卡片只用原语里的**壳**：`SettingsForm`（保存 / 丢弃 / 只读 / 不可用 /
 * 保存失败的约定）与 `SettingsFormShell` 类型；控件与草稿自己管，保存仍是一次带 revision 栅栏的 `mutate`。
 *
 * 写入路径（`SESSION_MODE_NS` = host 行 id，settings 的命名空间名就是它）：
 *
 * - 某一行选了模型：`{ op: 'set', path: ['models', <模式 id>], value: { provider, model, reasoningEffort? } }`
 * - 某一行回到装配层的值：`{ op: 'unset', path: ['models', <模式 id>] }`
 *
 * 为什么 `models` 在顶层而不在 `modes.<id>` 里：settings 的设置面只编辑 volatile 字段，且
 * `volatileForm` 只认固定路径（dict 内部的字段一律 blocked）。判据与取舍见
 * [ADR 模式默认模型搬到顶层 volatile](../../.agents/adrs/20260925-模式默认模型搬到顶层volatile.md)。
 */

import type { ModelProviderGroup } from "@deepseek-ai/dsh-api-remotes/client";
import { createSnapshotStore, type SnapshotStore } from "@deepseek-ai/dsh-client-store";
import type {
  SettingsFormPathOp,
  SettingsFormScope,
  SettingsFormShell,
} from "@morlay/dsh-client-ui-primitives/client";
import type { SessionModeModel, SessionModeModels } from "../modes.ts";
import type { SessionModeRoster } from "../shared.ts";

/** 本包 host 行 id：settings 的命名空间名与 `config` 的 volatile 字段都在它下面。 */
export const SESSION_MODE_NS = "session-mode";

/** settings 里这一段的可编辑形状（`volatileForm` 从 schema 上挑出来的那几个字段）。 */
export interface SessionModeSettings {
  /** 各模式的默认模型；省略或空对象＝一个都没配。 */
  readonly models?: SessionModeModels;
}

/** 卡片要的那部分模型目录：可以选的 provider / model 分组，以及读失败的 provider 显示名。 */
export interface ModelDirectory {
  /** 目录里有模型的 provider（`ctx.remote.session.modelCatalog()` 的成功分组）。 */
  readonly groups: readonly ModelProviderGroup[];
  /** 目录里读失败的 provider 显示名（部分失败：其余分组照常可用）。 */
  readonly failures: readonly string[];
}

/** 卡片的两条外部读取（都注入进来，测试给假的即可，不需要真的 ctx / HTTP）。 */
export interface ModelDefaultsSources {
  /** 模式清单：`GET /session-mode`（列哪些模式各一行）。 */
  roster(): Promise<SessionModeRoster>;
  /** 模型目录：`ctx.remote.session.modelCatalog()`；拒绝与抛错对卡片是同一件事——读不到目录。 */
  directory(): Promise<ModelDirectory>;
}

/** 一个模式一行：清单里的展示信息 + 当前值 + 草稿状态。 */
export interface ModelDefaultsRow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** 这一行当前显示的模型（草稿优先；草稿是"回到默认"时显示装配层那份）；`undefined` = 跟全局默认。 */
  readonly value?: SessionModeModel;
  /** 保存之后这一行会不会留下用户层那一条（有就得给"恢复默认"）。 */
  readonly overridden: boolean;
  /** 这一行有未保存的编辑。 */
  readonly dirty: boolean;
  /** 草稿不完整（选了 provider 没选 model）：它阻止保存。 */
  readonly invalid: boolean;
}

/** 卡片呈现的状态：表单壳 + 行 + 两条读取的落点。 */
export interface ModelDefaultsCardState extends SettingsFormShell {
  readonly rows: readonly ModelDefaultsRow[];
  /** 目录里的 provider 分组（选择器的选项来源）。 */
  readonly directory: readonly ModelProviderGroup[];
  readonly rosterStatus: "loading" | "ready" | "error";
  readonly directoryStatus: "loading" | "ready" | "error";
  /** 部分失败：这些 provider 的目录没读到。 */
  readonly directoryFailures: readonly string[];
}

/** 槽位渲染器绑定的状态与动作。 */
export interface ModelDefaultsCardFace {
  hooks: {
    modelDefaultsCard: SnapshotStore<ModelDefaultsCardState>;
  };
  /** 给某个模式换 provider；换 provider 会连 model 与档位一起清掉（档位是模型自带的）。 */
  setProvider(modeId: string, provider: string): void;
  /** 给某个模式选 model；新模型不认识旧档位时档位被清掉。 */
  setModel(modeId: string, model: string): void;
  /** 给某个模式选档位；空串＝跟模型（provider）默认。 */
  setEffort(modeId: string, effort: string): void;
  /** 这一行回到装配层的值（清掉用户层那一条）。 */
  resetMode(modeId: string): void;
  /** 把全部草稿写成一次 `mutate`。 */
  save(): void;
  /** 丢掉全部草稿。 */
  discard(): void;
}

/** 一个模式的草稿：`null` = 用户层那条清掉（回到装配层），`undefined` = 没动过。 */
type Draft = SessionModeModel | null;

/** 从 settings 的一层里取 `models`（层是原始 JSON 形状，取不到就是空）。 */
function layerModels(layer: unknown): SessionModeModels {
  const models: unknown = (layer as { models?: unknown } | null | undefined)?.models;
  return typeof models === "object" && models !== null ? (models as SessionModeModels) : {};
}

/** 两份模型是不是同一份（三个字段逐个比；缺省字段与 `undefined` 同义）。 */
function sameModel(left: SessionModeModel, right: SessionModeModel | undefined): boolean {
  return (
    right !== undefined &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort
  );
}

/** 草稿是不是半成品（选了 provider 还没选 model）——半成品不许保存。 */
function incomplete(draft: Draft | undefined): boolean {
  return draft !== undefined && draft !== null && draft.model === "";
}

/** 把 staged 的三元组写成 config 里的那个值（空档位不写键，别把"跟模型默认"物化成一个值）。 */
function modelValue(draft: SessionModeModel): Record<string, unknown> {
  return {
    provider: draft.provider,
    model: draft.model,
    ...(draft.reasoningEffort === undefined ? {} : { reasoningEffort: draft.reasoningEffort }),
  };
}

/** 把一张动态映射编辑成一次设置的写。 */
export class ModelDefaultsCardController {
  private readonly store: SnapshotStore<ModelDefaultsCardState>;
  private readonly unsubscribe: () => void;
  private readonly drafts = new Map<string, Draft>();
  private roster: SessionModeRoster | undefined;
  private rosterStatus: ModelDefaultsCardState["rosterStatus"] = "loading";
  private directory: readonly ModelProviderGroup[] = [];
  private directoryFailures: readonly string[] = [];
  private directoryStatus: ModelDefaultsCardState["directoryStatus"] = "loading";
  private saving = false;
  private failed = false;
  private disposed = false;
  private saveGeneration = 0;

  /**
   * @param scope - 本包 host 行（`session-mode`）的共享配置表单。
   * @param sources - 模式清单与模型目录的两条读取。
   */
  constructor(
    private readonly scope: SettingsFormScope<SessionModeSettings>,
    private readonly sources: ModelDefaultsSources,
  ) {
    this.store = createSnapshotStore(this.projection());
    // 装配层与用户层的变化（别人写、或者我们刚保存）都从这一条进来。
    this.unsubscribe = scope.subscribe(() => {
      this.publish();
    });
    void this.loadRoster();
    void this.loadDirectory();
  }

  /** 停止观察设置，并让晚到的写入结果不再落到状态上。 */
  dispose(): void {
    this.disposed = true;
    this.saveGeneration += 1;
    this.unsubscribe();
  }

  /**
   * 把状态与动作绑到槽位渲染器上。
   * @returns 快照与编辑、保存动作。
   */
  inject(): ModelDefaultsCardFace {
    return {
      hooks: { modelDefaultsCard: this.store },
      setProvider: (modeId, provider) => {
        this.setProvider(modeId, provider);
      },
      setModel: (modeId, model) => {
        this.setModel(modeId, model);
      },
      setEffort: (modeId, effort) => {
        this.setEffort(modeId, effort);
      },
      resetMode: (modeId) => {
        this.stage(modeId, null);
      },
      save: () => {
        void this.save();
      },
      discard: () => {
        this.discard();
      },
    };
  }

  /** 用户层有没有这一条。 */
  private overridden(modeId: string): boolean {
    return Object.hasOwn(layerModels(this.scope.getSnapshot().user), modeId);
  }

  /** 生效值（用户层叠在装配层上）。 */
  private current(modeId: string): SessionModeModel | undefined {
    return this.scope.getSnapshot().value?.models?.[modeId];
  }

  /** 装配层那份（用户层清掉之后剩下的）。 */
  private base(modeId: string): SessionModeModel | undefined {
    return layerModels(this.scope.getSnapshot().base)[modeId];
  }

  /**
   * 这一行现在的值：草稿优先，否则是生效值；草稿是"回到默认"时看装配层那份（它清掉的就是用户层）。
   * 同一个值既是选择器显示的东西，也是下一次编辑的起点。
   * @param modeId - 模式 id。
   * @returns 这一行呈现的模型；`undefined` = 跟全局默认。
   */
  private shown(modeId: string): SessionModeModel | undefined {
    const draft = this.drafts.get(modeId);
    if (draft === null) return this.base(modeId);
    return draft ?? this.current(modeId);
  }

  /**
   * 这一行的草稿算不算一次真的编辑。
   * @param modeId - 模式 id。
   * @returns 保存会不会改变什么。
   */
  private dirty(modeId: string): boolean {
    const draft = this.drafts.get(modeId);
    if (draft === undefined) return false;
    // "回到默认"只在用户层有那一条时才算改了东西（装配层没有用户层这一条）。
    if (draft === null) return this.overridden(modeId);
    return !sameModel(draft, this.current(modeId));
  }

  /** 保存之后这一行会不会留下用户层那一条（"已覆盖"与"恢复默认"都看它）。 */
  private leavesOverride(modeId: string): boolean {
    return this.overridden(modeId) || this.drafts.get(modeId) !== undefined;
  }

  private setProvider(modeId: string, provider: string): void {
    if (!this.writable() || provider === this.shown(modeId)?.provider) return;
    // 选择器里的空 provider 就是"跟全局默认"：这一行回到装配层的值（与"恢复默认"同一个动作）。
    if (provider === "") {
      this.stage(modeId, null);
      return;
    }
    // 换 provider 等于换了能选的模型集：model 与档位一起清掉（档位是模型自带的）。
    this.stage(modeId, { provider, model: "" });
  }

  private setModel(modeId: string, model: string): void {
    const current = this.shown(modeId);
    if (!this.writable() || current === undefined) return;
    const efforts = this.efforts(current.provider, model);
    const keep = efforts.some((effort) => effort.id === current.reasoningEffort);
    this.stage(modeId, {
      provider: current.provider,
      model,
      ...(keep && current.reasoningEffort !== undefined
        ? { reasoningEffort: current.reasoningEffort }
        : {}),
    });
  }

  private setEffort(modeId: string, effort: string): void {
    const current = this.shown(modeId);
    if (!this.writable() || current === undefined) return;
    this.stage(modeId, {
      provider: current.provider,
      model: current.model,
      ...(effort === "" ? {} : { reasoningEffort: effort }),
    });
  }

  private stage(modeId: string, draft: Draft): void {
    if (!this.writable()) return;
    this.drafts.set(modeId, draft);
    this.failed = false;
    this.publish();
  }

  private discard(): void {
    if (this.saving || this.drafts.size === 0) return;
    this.drafts.clear();
    this.failed = false;
    this.publish();
  }

  /** 可以编辑：这一行被服务到（`status: ready`）且文档接受写入。 */
  private writable(): boolean {
    const snapshot = this.scope.getSnapshot();
    return !this.disposed && !this.saving && snapshot.status === "ready" && snapshot.writable;
  }

  /** 这一次保存要写的 path op（按编辑顺序；没变的行不写）。 */
  private plannedOps(): SettingsFormPathOp[] {
    const ops: SettingsFormPathOp[] = [];
    for (const [modeId, draft] of this.drafts) {
      if (!this.dirty(modeId)) continue;
      ops.push(
        draft === null
          ? { op: "unset", path: ["models", modeId] }
          : { op: "set", path: ["models", modeId], value: modelValue(draft) },
      );
    }
    return ops;
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot();
    const ops = this.plannedOps();
    if (
      this.disposed ||
      this.saving ||
      snapshot.status !== "ready" ||
      !snapshot.writable ||
      ops.length === 0 ||
      [...this.drafts.values()].some(incomplete)
    ) {
      return;
    }
    const generation = this.saveGeneration;
    this.saving = true;
    this.failed = false;
    this.publish();
    let landed = false;
    try {
      // revision 栅栏：以读到这些值的那个 revision 为准，别盖掉别人后写的改动。
      landed = await this.scope.mutate(ops, snapshot.revision);
    } catch {
      landed = false;
    }
    if (generation !== this.saveGeneration || this.disposed) return;
    this.saving = false;
    this.failed = !landed;
    if (landed) this.drafts.clear();
    this.publish();
  }

  private async loadRoster(): Promise<void> {
    try {
      this.roster = await this.sources.roster();
      this.rosterStatus = "ready";
    } catch {
      this.rosterStatus = "error";
    }
    if (!this.disposed) this.publish();
  }

  private async loadDirectory(): Promise<void> {
    try {
      const directory = await this.sources.directory();
      this.directory = directory.groups;
      this.directoryFailures = directory.failures;
      this.directoryStatus = "ready";
    } catch {
      this.directoryStatus = "error";
    }
    if (!this.disposed) this.publish();
  }

  /** 某个 provider 在目录里的模型。 */
  private modelsOf(provider: string): ModelProviderGroup["models"] {
    return this.directory.find((group) => group.id === provider)?.models ?? [];
  }

  /** 某个 provider + model 声明的档位（模型自带；没声明就是没有）。 */
  private efforts(provider: string, model: string): readonly { readonly id: string; readonly name: string }[] {
    return this.modelsOf(provider).find((entry) => entry.id === model)?.reasoning?.efforts ?? [];
  }

  private projection(): ModelDefaultsCardState {
    const snapshot = this.scope.getSnapshot();
    const invalid = [...this.drafts.values()].some(incomplete);
    return {
      available: snapshot.status === "ready",
      writable: snapshot.writable,
      dirty: [...this.drafts.keys()].some((modeId) => this.dirty(modeId)),
      invalid,
      saving: this.saving,
      failed: this.failed,
      rows: (this.roster?.modes ?? []).map((mode) => {
        const value = this.shown(mode.id);
        return {
          id: mode.id,
          name: mode.name,
          ...(mode.description === undefined ? {} : { description: mode.description }),
          ...(value === undefined ? {} : { value }),
          overridden: this.leavesOverride(mode.id),
          dirty: this.dirty(mode.id),
          invalid: incomplete(this.drafts.get(mode.id)),
        };
      }),
      directory: this.directory,
      rosterStatus: this.rosterStatus,
      directoryStatus: this.directoryStatus,
      directoryFailures: this.directoryFailures,
    };
  }

  private publish(): void {
    this.store.set(this.projection());
  }
}
