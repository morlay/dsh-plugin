/**
 * 设置页「会话模式」那张卡片：每个模式一行「默认模型」，一段一起保存。
 *
 * 页面（Plugins 列表）画标题与一句话说明：`view: 'summary'` 给那句话，`view: 'page'` 给表单。编辑是 staged
 * 的——选择器只改草稿，按保存才写一次 `mutate`；"恢复默认"（或把 provider 选回「跟全局默认」）把这一行的
 * 用户层清掉，回到装配层那份。控件是本卡自研的：这里的编辑面是一张**动态映射**（模式 → provider / model /
 * 档位），原语的标量字段控件套不进去——只借它的壳（保存 / 丢弃 / 只读 / 失败与 `SettingsFormShell`）。
 */

import { useId } from "react";
import type { ModelProviderGroup } from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type { InjectFace, PropsRuntime, TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import { SettingsForm, styling } from "@morlay/dsh-client-ui-primitives/client";
import type { ModelDefaultsCardFace, ModelDefaultsRow } from "./model-defaults-card-controller.ts";
import { formLabels } from "./locales.ts";
import { styles } from "./ModelDefaultsCard.styles.ts";

/** 槽位渲染器给卡片的 props：运行时面 + 卡片自己的注入面（`t` 由本包的 `inject` 面带进来）。 */
export type ModelDefaultsCardProps = PropsRuntime<"plugins.row.config"> &
  InjectFace<ModelDefaultsCardFace & { t: Translate }>;

/** 本页字典的读取器（命名空间的 key 由 `LocaleNamespaceMap` 合并声明给）。 */
type Translate = TranslateNS<"session-mode">;

/** 一个下拉选项：目录里的那条，或"当前值不在目录里"时补上的那条。 */
interface Option {
  readonly id: string;
  readonly name: string;
}

/**
 * 选择器的选项：目录里的那些 + 当前值那条（不在目录里时补上）。
 *
 * 补当前值是必须的：`<select>` 的 value 不在选项里时浏览器会显示成别的选项，用户按保存就会把它写成
 * 那个值——配置被悄悄改掉。（目录读不到、或适配器卸了的时候正是这个局面。）
 * @param entries - 目录里的选项（provider 或 model）。
 * @param current - 当前生效值的那一项 id。
 * @param t - 本页字典。
 * @returns 选项列表。
 */
function options(
  entries: readonly Option[],
  current: string | undefined,
  t: Translate,
): Option[] {
  if (current === undefined || entries.some((entry) => entry.id === current)) return [...entries];
  return [...entries, { id: current, name: t("staleOption", { value: current }) }];
}

/**
 * 画一个模式的默认模型那一行。
 * @param props - 这一行的值、可选项、字典与编辑动作。
 * @returns 一行选择器（provider / model / 档位）与"恢复默认"。
 */
function ModeRow({
  row,
  groups,
  disabled,
  t,
  onProvider,
  onModel,
  onEffort,
  onReset,
}: {
  row: ModelDefaultsRow;
  groups: readonly ModelProviderGroup[];
  disabled: boolean;
  t: Translate;
  onProvider: (provider: string) => void;
  onModel: (model: string) => void;
  onEffort: (effort: string) => void;
  onReset: () => void;
}) {
  const models = groups.find((group) => group.id === row.value?.provider)?.models ?? [];
  const model = models.find((entry) => entry.id === row.value?.model);
  const efforts = model?.reasoning?.efforts ?? [];
  // 存着的档位即使目录里没有也要看得见（否则它成了看不见的值）。
  const withEffort = efforts.length > 0 || row.value?.reasoningEffort !== undefined;

  return (
    <div {...styling.props(styles.row)}>
      <div {...styling.props(styles.rowHead)}>
        <span {...styling.props(styles.rowName)}>{row.name}</span>
        {row.overridden ? <span {...styling.props(styles.badge)}>{t("overridden")}</span> : null}
        <button
          type="button"
          {...styling.props(styles.reset)}
          disabled={disabled || !row.overridden}
          onClick={onReset}
        >
          {t("reset")}
        </button>
      </div>
      {row.description === undefined ? null : <p {...styling.props(styles.rowHint)}>{row.description}</p>}
      <div {...styling.props(styles.fields)}>
        <label {...styling.props(styles.field)}>
          <span {...styling.props(styles.fieldLabel)}>{t("providerLabel")}</span>
          <select
            {...styling.props(styles.select)}
            value={row.value?.provider ?? ""}
            disabled={disabled}
            onChange={(event) => {
              onProvider(event.target.value);
            }}
          >
            <option value="">{t("inheritOption")}</option>
            {options(
              groups.map((group) => ({ id: group.id, name: group.name })),
              row.value?.provider,
              t,
            ).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label {...styling.props(styles.field)}>
          <span {...styling.props(styles.fieldLabel)}>{t("modelLabel")}</span>
          <select
            {...styling.props(styles.select)}
            value={row.value?.model ?? ""}
            disabled={disabled || row.value === undefined}
            onChange={(event) => {
              onModel(event.target.value);
            }}
          >
            <option value="">{t("chooseModel")}</option>
            {options(
              models.map((entry) => ({ id: entry.id, name: entry.name })),
              row.value?.model,
              t,
            ).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {row.invalid ? (
            <span {...styling.props(styles.invalid)} role="status">
              {t("modelRequired")}
            </span>
          ) : null}
        </label>
        {withEffort ? (
          <label {...styling.props(styles.field)}>
            <span {...styling.props(styles.fieldLabel)}>{t("effortLabel")}</span>
            <select
              {...styling.props(styles.select)}
              value={row.value?.reasoningEffort ?? ""}
              disabled={disabled || row.value?.model === undefined || row.value.model === ""}
              onChange={(event) => {
                onEffort(event.target.value);
              }}
            >
              <option value="">{t("effortDefaultOption")}</option>
              {options(
                efforts.map((effort) => ({ id: effort.id, name: effort.name })),
                row.value?.reasoningEffort,
                t,
              ).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 渲染这张卡片（或它的一句话说明）。
 * @param props - 字典、快照，以及编辑与保存 / 丢弃动作。
 * @returns 摘要文本，或每个模式一行的默认模型表单。
 */
export function ModelDefaultsCard(props: ModelDefaultsCardProps) {
  const { t } = props;
  const state = props.useModelDefaultsCard((snapshot) => snapshot);
  const headingId = useId();
  if (props.view === "summary") return t("cardDescription");
  const disabled = !state.writable || state.saving;

  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      {state.available
        ? (
          <section {...styling.props(styles.section)} aria-labelledby={headingId}>
            <h3 {...styling.props(styles.heading)} id={headingId}>{t("defaultsTitle")}</h3>
            <p {...styling.props(styles.hint)}>{t("defaultsHint")}</p>
            {state.rosterStatus === "error" ? <p {...styling.props(styles.notice)} role="status">{t("rosterFailed")}</p> : null}
            {state.directoryStatus === "error"
              ? <p {...styling.props(styles.notice)} role="status">{t("directoryFailed")}</p>
              : null}
            {state.directoryFailures.length > 0
              ? (
                <p {...styling.props(styles.notice)} role="status">
                  {t("directoryPartial", { names: state.directoryFailures.join("、") })}
                </p>
              )
              : null}
            <div {...styling.props(styles.rows)}>
              {state.rows.map((row) => (
                <ModeRow
                  key={row.id}
                  row={row}
                  groups={state.directory}
                  disabled={disabled}
                  t={t}
                  onProvider={(provider) => {
                    props.setProvider(row.id, provider);
                  }}
                  onModel={(model) => {
                    props.setModel(row.id, model);
                  }}
                  onEffort={(effort) => {
                    props.setEffort(row.id, effort);
                  }}
                  onReset={() => {
                    props.resetMode(row.id);
                  }}
                />
              ))}
            </div>
          </section>
        )
        : null}
    </SettingsForm>
  );
}
