/**
 * 自动注册面：把 describe 出来的命名空间与 bundle 的行清单配对，为每个能渲染的行注册本行的配置入口。
 *
 * 注册用 `<bundle 包名>#<行 id>`（页面按同一个 key 打开这一行的配置页）与兜底 priority：手写卡片用默认
 * priority 0 注册，按 slots 的 cell winner 规则自然遮住这里的自动项，与加载顺序无关。
 */

import type { BundleInfo, SettingsNamespaceView } from "@deepseek-ai/dsh-api-remotes/client";
import type { SettingsDescribeFace } from "@deepseek-ai/dsh-client-ui-settings/client";

/** 一个该自动长出配置页的行。 */
export interface RowRegistrationPlan {
  /** `plugins.row.config` 的 key：`<bundle 包名>#<行 id>`。 */
  key: string;
  /** settings 命名空间（行 id）。 */
  ns: string;
}

/**
 * 配对命名空间与 bundle 行清单。
 * @param namespaces - host 发来的命名空间视图。
 * @param bundles - host 的 bundle 清单（含各 bundle 声明的行 id）。
 * @returns 该自动注册的行，按命名空间视图的顺序。
 */
export function rowRegistrations(
  namespaces: readonly SettingsNamespaceView[],
  bundles: readonly BundleInfo[],
): RowRegistrationPlan[] {
  const owners = new Map<string, string>();
  for (const bundle of bundles) {
    for (const row of bundle.rows) owners.set(row.rowId, bundle.name);
  }
  const plans: RowRegistrationPlan[] = [];
  for (const view of namespaces) {
    if (view.autoGenerate !== true) continue;
    const owner = owners.get(view.ns);
    if (owner === undefined) continue;
    plans.push({ key: `${owner}#${view.ns}`, ns: view.ns });
  }
  return plans;
}

/** 注册器要的外部面。 */
export interface RowRegistrationDeps {
  /** 槽位注册：返回注销函数。 */
  slots: {
    register(
      options: {
        name: "plugins.row.config";
        key: string;
        priority: number;
        locale: string;
      },
      component: unknown,
    ): () => void;
  };
  /** describe 读面：命名空间清单与变更通知。 */
  describe: SettingsDescribeFace;
  /** 读 bundle 清单。 */
  bundles(): Promise<readonly BundleInfo[]>;
  /** 订阅 bundle 清单变化。 */
  subscribeBundles(listener: () => void): () => void;
  /**
   * 一行的注册项组件；`undefined` 表示这一行渲染不了（schema rehydrate 不了或段根不是对象）。
   * 每次调用返回同一个实例（控制器按命名空间缓存）。
   */
  entryFor(ns: string): { component: unknown } | undefined;
  /** 槽项文案的命名空间。 */
  locale: string;
  /** 一行注销时释放它的控制器。 */
  release(ns: string): void;
}

/** 自动项的兜底优先级：手写卡片（默认 0）遮住它。 */
const FALLBACK_PRIORITY = 100;

/**
 * 自动注册的差分器：按 describe 与 bundle 清单把「该有的行」与「已在的行」对齐。
 */
export class RowRegistration {
  readonly #deps: RowRegistrationDeps;
  readonly #live = new Map<string, () => void>();
  #pending: Promise<void> | undefined;
  #disposed = false;

  /**
   * @param deps - 槽位、清单读面与每行的槽项工厂。
   */
  constructor(deps: RowRegistrationDeps) {
    this.#deps = deps;
  }

  /**
   * 对齐一次：新增该有的行，注销不该有的行。
   *
   * 并发调用折叠成一次（bundle 清单只读一趟），后到的调用等同一趟结束。
   * @returns 对齐完成。
   */
  sync(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#pending ??= this.#run().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  /** 收掉自己：注销还活着的全部注册并释放它们的控制器。 */
  dispose(): void {
    this.#disposed = true;
    this.#release();
  }

  async #run(): Promise<void> {
    const bundles = await this.#deps.bundles();
    if (this.#disposed) return;
    const namespaces = this.#deps.describe.getSnapshot().view?.namespaces ?? [];
    const wanted = new Map<string, RowRegistrationPlan>();
    for (const plan of rowRegistrations(namespaces, bundles)) {
      if (this.#deps.entryFor(plan.ns) === undefined) continue;
      wanted.set(plan.ns, plan);
    }
    for (const [ns, dispose] of this.#live) {
      if (wanted.has(ns)) continue;
      dispose();
      this.#live.delete(ns);
      this.#deps.release(ns);
    }
    for (const [ns, plan] of wanted) {
      if (this.#live.has(ns)) continue;
      const entry = this.#deps.entryFor(ns);
      if (entry === undefined) continue;
      const dispose = this.#deps.slots.register(
        {
          name: "plugins.row.config",
          key: plan.key,
          priority: FALLBACK_PRIORITY,
          locale: this.#deps.locale,
        },
        entry.component,
      );
      this.#live.set(ns, dispose);
    }
  }

  /** 注销全部并释放控制器。 */
  #release(): void {
    for (const [ns, dispose] of this.#live) {
      dispose();
      this.#live.delete(ns);
      this.#deps.release(ns);
    }
  }
}
