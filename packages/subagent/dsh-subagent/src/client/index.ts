/**
 * client 半：**本行**（`subagent-fork`）的配置入口——限额一段（递归深度与并行上限）。
 *
 * | 面                                                          | 呈现                                              |
 * | ----------------------------------------------------------- | ------------------------------------------------- |
 * | `plugins.row.config`（key `@morlay/dsh-subagent#subagent-fork`） | `view: 'summary'` 是那句话；`view: 'page'` 是限额表单 |
 *
 * 数据面是本包 host 行的 settings namespace **`subagent-fork`**（namespace 名就是行 id，见
 * `subagent-limits-card-controller.ts`）：host 行被描述出来之后（`configForms.whileServed`）条目才注册，
 * 行不在时条目也一起消失。
 *
 * 为什么是 `plugins.row.config` 而不是 `plugins.item`：后者是**官方分组**（上游契约里由官方那几张设置卡
 * 占用，一个 host 命名空间一个伴生包），bundle / 行的配置按契约就该落在自己的 bundle 或行上；我们的数据面
 * 正好就是本行的 config。官方那张子代理卡仍由本包 patch 停掉——它读的是官方行 id 那个 namespace，本部署
 * 已没有那一行，入口整体换成这份。
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { SubagentLimitsCard } from "./SubagentLimitsCard.tsx";
import { en, zh, type SubagentSettingsLocaleKey } from "./locales.ts";
import { SUBAGENT_NS, SubagentLimitsCardController } from "./subagent-limits-card-controller.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 子代理设置卡的文案。 */
    "settings.subagent": SubagentSettingsLocaleKey;
  }
}

export type { SubagentLimitsCardProps } from "./SubagentLimitsCard.tsx";
export type {
  SubagentLimitsCardFace,
  SubagentLimitsCardState,
  SubagentLimitsSettings,
} from "./subagent-limits-card-controller.ts";
export type { SubagentSettingsLocaleKey } from "./locales.ts";

/** 本页字典的命名空间。 */
export const NS = "settings.subagent";

/**
 * 本行的配置入口 key：`<bundle 包名>#<行 id>`。
 *
 * 页面侧由 `ui-plugin-manager` 的 `rowConfigKey(bundle, rowId)` 生成同一个串——bundle 是本包
 * （`dsh.profile.bundles` 里那一项），行 id 是本包 patch 里插的 `subagent-fork`。
 */
export const SUBAGENT_ROW_CONFIG_KEY = "@morlay/dsh-subagent#subagent-fork";

/** 需要的服务：槽位（ui-renderer 提供的 registry）、字典、共享配置表单。 */
export const inject = ["slots", "locale", "configForms"];

/**
 * 装上设置页那张卡片。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-subagent: dictionaries");
  const limits = new SubagentLimitsCardController(ctx.configForms.get(SUBAGENT_NS));
  ctx.effect(
    () => () => {
      limits.dispose();
    },
    "dsh-subagent: limits form subscription",
  );
  const face = limits.inject();
  // 注册到**本行**的配置入口（`plugins.row.config`，key = `<bundle 包名>#<行 id>`，与页面
  // `config-ledger.ts` 的 `rowConfigKey()` 同拼法）：这一行是本包 bundle patch 插的 `subagent-fork`，
  // 页面把 configure 入口画在那行的页面上。`plugins.item` 是官方分组（由官方那几张设置卡占用），
  // 我们不去挤它。`inject` 等槽声明到位再注册：本包与 ui-plugin-manager 谁先装都不影响。
  ctx.effect(
    () =>
      ctx.configForms.whileServed([SUBAGENT_NS], () =>
        ctx.slots.inject("plugins.row.config", () =>
          ctx.slots.register(
            {
              name: "plugins.row.config",
              key: SUBAGENT_ROW_CONFIG_KEY,
              // 文案经我们自己的注入面传：keyed 槽的注册项不带 `locale` 声明，不赌页面一定注入字典。
              inject: () => ({ ...face, t }),
            },
            SubagentLimitsCard,
          ),
        ),
      ),
    "dsh-subagent: settings page",
  );
}
