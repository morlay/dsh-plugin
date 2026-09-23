/**
 * 设置页的「子代理」卡片：限额一段（递归深度与并行上限）。
 *
 * 页面画标题与一句话说明，卡片只画控件与保存：`view: 'summary'` 时给那句话，`view: 'page'` 时给表单。
 * 两个字段都是 staged 编辑——输入只改草稿，保存才写；非法草稿停在屏幕上并禁用保存。
 */

import { useId } from "react";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type { InjectFace, PropsRuntime, TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import { SettingsForm, SettingsValueField, styling } from "@morlay/dsh-client-ui-primitives/client";
import { styles } from "./SubagentLimitsCard.styles.ts";
import { formLabels } from "./locales.ts";
import type { SubagentLimitsCardFace } from "./subagent-limits-card-controller.ts";

/** 槽位渲染器给卡片的 props：运行时面 + 限额表单与字典的注入面（`t` 由本包的 `inject` 面带进来）。 */
export type SubagentLimitsCardProps = PropsRuntime<"plugins.row.config"> &
  InjectFace<SubagentLimitsCardFace & { t: TranslateNS<"settings.subagent"> }>;

/**
 * 画限额那一段（或它的一句话说明）。
 * @param props - 字典、限额快照、以及编辑与保存/丢弃动作。
 * @returns 摘要文本，或带保存脚注的限额表单。
 */
export function SubagentLimitsCard(props: SubagentLimitsCardProps) {
  const { t } = props;
  const state = props.useSubagentLimitsCard((snapshot) => snapshot);
  const headingId = useId();
  if (props.view === "summary") return t("subagentDescription");
  return (
    <SettingsForm
      labels={formLabels(t)}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {state.available ? (
        <section {...styling.props(styles.section)} aria-labelledby={headingId}>
          <h3 {...styling.props(styles.heading)} id={headingId}>
            {t("subagentLimitsTitle")}
          </h3>
          <div {...styling.props(styles.limits)}>
            <SettingsValueField
              id="plugin-config-subagent-depth"
              label={t("subagentMaxDepth")}
              help={{
                label: t("subagentDepthHelpLabel"),
                content: <p>{t("subagentDepthHelp")}</p>,
              }}
              overriddenLabel={t("overridden")}
              resetLabel={t("reset")}
              invalidLabel={t("subagentDepthInvalid")}
              numeric
              disabled={!state.writable || state.saving}
              {...state.maxDepth}
              onEdit={(text) => {
                props.edit("maxDepth", text);
              }}
              onReset={() => {
                props.resetField("maxDepth");
              }}
            />
            <SettingsValueField
              id="plugin-config-subagent-capacity"
              label={t("subagentMaxActive")}
              help={{
                label: t("subagentCapacityHelpLabel"),
                content: <p>{t("subagentCapacityHelp")}</p>,
              }}
              overriddenLabel={t("overridden")}
              resetLabel={t("reset")}
              invalidLabel={t("subagentCapacityInvalid")}
              numeric
              disabled={!state.writable || state.saving}
              {...state.maxActiveSubagents}
              onEdit={(text) => {
                props.edit("maxActiveSubagents", text);
              }}
              onReset={() => {
                props.resetField("maxActiveSubagents");
              }}
            />
          </div>
        </section>
      ) : null}
    </SettingsForm>
  );
}
