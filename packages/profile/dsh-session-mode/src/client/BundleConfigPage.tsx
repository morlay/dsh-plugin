// bundle 配置页：装这个 bundle 的那一行（`session-mode`）的完整配置——新会话的默认模式 + 每个模式一张可折叠卡片。
//
// 注册进 `plugins.bundle.config`（key = bundle 包名），读写的命名空间是 `session-mode`。草稿、整段校验与保存都归通用
// schema 表单的控制器（`bundle-config.ts` 的注入面），本文件只管布局与控件：卡片头是官方折叠行，展开后按分组摆字段，
// 卡片内没有"立即生效"的写——一切改动先落草稿，底部保存是唯一写盘点。

import { useId, useState, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  DisclosureRow,
  IconAgentPresetOutlineRegular,
  IconCloseOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  SegmentedControl,
  SettingsForm,
  Tag,
  type SettingsFormLabels,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { SchemaFormState } from "@morlay/dsh-client-ui-primitives/client";
import {
  projectBundleConfig,
  ROLES,
  type BundleConfigActions,
  type BundleConfigFace,
  type BundleFieldView,
  type BundleModeView,
  type BundleTranslate,
} from "./bundle-config.ts";
import { className, props as stylingProps, styles } from "./BundleConfigPage.styles.ts";

export type BundleConfigPageProps = PropsRuntime<"plugins.bundle.config"> &
  PropsLocale<"session-mode-bundle"> &
  InjectFace<BundleConfigFace>;

// tri 控件的三个档：`unset` 是"配置里没写这个键"（按工具名单推导），另两档是显式开关值。
type TriValue = "unset" | "on" | "off";

export function BundleConfigPage(props: BundleConfigPageProps): ReactNode {
  const { t, view } = props;
  // 子组件只收动作面：读数走框架绑好的 `useBundleConfig`，动作是同一份注入面里的函数。
  const face: BundleConfigActions = {
    set: props.set,
    editText: props.editText,
    clear: props.clear,
    appendItem: props.appendItem,
    removeItem: props.removeItem,
    addMode: props.addMode,
    removeMode: props.removeMode,
    save: props.save,
    discard: props.discard,
  };
  const state = props.useBundleConfig((snapshot: SchemaFormState) =>
    projectBundleConfig(snapshot, t),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [adding, setAdding] = useState("");
  const triId = useId();
  // 槽位注册项只为 `page` 视图存在（bundle 页不给 `summary` 座位）。
  if (view !== "page") return null;
  if (!state.configured) {
    return (
      <p {...stylingProps(styles.hint)} data-bundle-config="missing">
        {t("configured.missing")}
      </p>
    );
  }
  const labels: SettingsFormLabels = {
    unavailable: t("unavailable"),
    readOnly: t("readOnly"),
    saveFailed: t("saveFailed"),
    save: t("save"),
    saving: t("saving"),
  };
  const toggle = (id: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <SettingsForm labels={labels} state={state} onSave={face.save} onDiscard={face.discard}>
      <div {...stylingProps(styles.root)} data-bundle-config="page">
        <section {...stylingProps(styles.section)} data-section="default">
          <h4 {...stylingProps(styles.sectionTitle)}>{t("default.label")}</h4>
          <p {...stylingProps(styles.hint)}>{t("default.hint")}</p>
          <div {...stylingProps(styles.defaultRow)}>
            <select
              {...stylingProps(styles.select)}
              data-field="default"
              value={state.defaultMode.value}
              disabled={!state.writable}
              aria-label={t("default.label")}
              onChange={(event) => {
                face.set(["default"], event.currentTarget.value);
              }}
            >
              {state.defaultMode.options.some(
                (option) => String(option.value) === state.defaultMode.value,
              ) ? null : (
                <option value={state.defaultMode.value}>
                  {state.defaultMode.value || t("tri.unset")}
                </option>
              )}
              {state.defaultMode.options.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label ?? String(option.value)}
                </option>
              ))}
            </select>
            {state.defaultMode.invalid === undefined ? null : (
              <p {...stylingProps(styles.invalid)} role="alert" data-invalid="default">
                {state.defaultMode.invalid}
              </p>
            )}
          </div>
        </section>

        <section {...stylingProps(styles.section)} data-section="modes">
          <h4 {...stylingProps(styles.sectionTitle)}>{t("modes.label")}</h4>
          <p {...stylingProps(styles.hint)}>{t("modes.hint")}</p>
          {state.modes.map((mode) => (
            <ModeCard
              key={mode.id}
              mode={mode}
              open={expanded.has(mode.id)}
              writable={state.writable}
              triId={triId}
              t={t}
              face={face}
              onToggle={() => {
                toggle(mode.id);
              }}
            />
          ))}
          <div {...stylingProps(styles.addRow)}>
            <Input
              className={className(styles.addInput)}
              data-field="new-mode"
              value={adding}
              placeholder={t("add.placeholder")}
              aria-label={t("add.label")}
              disabled={!state.writable}
              onChange={(event) => {
                setAdding(event.currentTarget.value);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              data-action="add-mode"
              disabled={!state.writable || adding.trim() === ""}
              onClick={() => {
                const id = adding.trim();
                face.addMode(id);
                setAdding("");
                setExpanded((previous) => new Set(previous).add(id));
              }}
            >
              {t("add.confirm")}
            </Button>
          </div>
        </section>
      </div>
    </SettingsForm>
  );
}

// 一张模式卡片：折叠头显示名称与摘要，展开后是分组字段与删除入口。
function ModeCard({
  mode,
  open,
  writable,
  triId,
  t,
  face,
  onToggle,
}: {
  mode: BundleModeView;
  open: boolean;
  writable: boolean;
  triId: string;
  t: BundleTranslate;
  face: BundleConfigActions;
  onToggle: () => void;
}): ReactNode {
  const model = mode.groups.find((group) => group.key === "model");
  const hasModel = model?.fields.some((field) => field.present) === true;
  return (
    <div
      {...stylingProps(styles.modeCard)}
      data-mode={mode.id}
      data-deletable={mode.deletable ? "true" : "false"}
    >
      <DisclosureRow
        icon={<IconAgentPresetOutlineRegular />}
        title={mode.title}
        open={open}
        expandable
        expandOnRowClick
        onToggle={onToggle}
        collapsedContent={<span {...stylingProps(styles.modeSummary)}>{mode.summary}</span>}
      >
        <div {...stylingProps(styles.modeBody)}>
          <div {...stylingProps(styles.modeMeta)}>
            <code {...stylingProps(styles.modeId)} data-mode-id>
              {mode.id}
            </code>
            {mode.role.map((role) => (
              <Tag key={role} tone="quiet">
                {role}
              </Tag>
            ))}
          </div>
          {mode.groups.map((group) => (
            <div key={group.key} {...stylingProps(styles.group)} data-group={group.key}>
              <div {...stylingProps(styles.groupHead)}>
                <span {...stylingProps(styles.groupTitle)}>{group.label}</span>
                {group.key !== "model" ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    data-action={hasModel ? "clear-model" : "set-model"}
                    disabled={!writable}
                    onClick={() => {
                      // 整个 `defaultModel` 是一个可加字段：没有就是跟随全局，清掉它同样回到跟随全局。
                      if (hasModel) face.clear(["modes", mode.id, "defaultModel"]);
                      else
                        face.set(["modes", mode.id, "defaultModel"], { provider: "", model: "" });
                    }}
                  >
                    {hasModel ? t("model.follow") : t("model.set")}
                  </Button>
                )}
              </div>
              {group.fields.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  writable={writable}
                  triId={triId}
                  t={t}
                  face={face}
                />
              ))}
            </div>
          ))}
          <div {...stylingProps(styles.modeFooter)}>
            {mode.deletable ? (
              <Button
                variant="outline"
                size="sm"
                data-action="remove-mode"
                disabled={!writable}
                aria-label={t("removeNamed", { name: mode.title })}
                onClick={() => {
                  face.removeMode(mode.id);
                }}
              >
                <IconTrashOutlineRegular size={13} />
                {t("remove")}
              </Button>
            ) : (
              <span {...stylingProps(styles.hint)} data-protected="true">
                {t("protected")}
              </span>
            )}
          </div>
        </div>
      </DisclosureRow>
    </div>
  );
}

// 一个字段行：左标签 + 右控件；开关与三态把标签交给控件本身（官方控件都自带标签）。
function FieldRow({
  field,
  writable,
  triId,
  t,
  face,
}: {
  field: BundleFieldView;
  writable: boolean;
  triId: string;
  t: BundleTranslate;
  face: BundleConfigActions;
}): ReactNode {
  const inline = field.control === "switch" || field.control === "tri";
  const control = (
    <FieldControl
      field={field}
      writable={writable}
      triId={`${triId}-${field.key}`}
      t={t}
      face={face}
    />
  );
  return (
    <div
      {...stylingProps(styles.field)}
      data-field={field.path.join(".")}
      data-control={field.control}
    >
      {inline ? null : <span {...stylingProps(styles.fieldLabel)}>{field.label}</span>}
      <div {...stylingProps(styles.fieldBody)}>
        {control}
        {field.invalid === undefined ? null : (
          <p {...stylingProps(styles.invalid)} role="alert" data-invalid={field.path.join(".")}>
            {field.invalid}
          </p>
        )}
      </div>
    </div>
  );
}

function FieldControl({
  field,
  writable,
  triId,
  t,
  face,
}: {
  field: BundleFieldView;
  writable: boolean;
  triId: string;
  t: BundleTranslate;
  face: BundleConfigActions;
}): ReactNode {
  const disabled = !writable;
  switch (field.control) {
    case "text":
      return (
        <Input
          data-field-control="text"
          value={field.text}
          disabled={disabled}
          aria-label={field.label}
          aria-invalid={field.invalid !== undefined}
          onChange={(event) => {
            face.editText(field.path, event.currentTarget.value);
          }}
        />
      );
    case "multiline":
      return (
        <textarea
          {...stylingProps(styles.multiline)}
          data-field-control="multiline"
          value={field.text}
          rows={3}
          disabled={disabled}
          aria-label={field.label}
          onChange={(event) => {
            face.editText(field.path, event.currentTarget.value);
          }}
        />
      );
    case "switch":
      return (
        <Checkbox
          checked={field.value === true}
          label={field.label}
          disabled={disabled}
          onChange={(next) => {
            face.set(field.path, next);
          }}
        />
      );
    case "tri":
      return (
        <SegmentedControl<TriValue>
          id={triId}
          label={field.label}
          value={triValue(field)}
          disabled={disabled}
          options={[
            { value: "unset", label: t("tri.unset") },
            { value: "on", label: t("tri.on") },
            { value: "off", label: t("tri.off") },
          ]}
          onChange={(next) => {
            if (next === "unset") face.clear(field.path);
            else face.set(field.path, next === "on");
          }}
        />
      );
    case "roles":
      return (
        <div {...stylingProps(styles.roles)} data-field-control="roles">
          {ROLES.map((role) => (
            <Checkbox
              key={role}
              checked={Array.isArray(field.value) && field.value.includes(role)}
              label={role}
              disabled={disabled}
              onChange={(next) => {
                const current = Array.isArray(field.value) ? field.value.map(String) : [];
                const wanted = next
                  ? [...current.filter((value) => value !== role), role]
                  : current.filter((value) => value !== role);
                face.set(field.path, wanted);
              }}
            />
          ))}
        </div>
      );
    case "select":
      // 候选读不到时退回文本输入：否则用户在这条字段上没有可选项（死胡同）。
      if (field.options.length === 0) {
        return (
          <Input
            data-field-control="text"
            value={field.text}
            disabled={disabled}
            aria-label={field.label}
            onChange={(event) => {
              face.editText(field.path, event.currentTarget.value);
            }}
          />
        );
      }
      return (
        <select
          {...stylingProps(styles.select)}
          data-field-control="select"
          value={field.text}
          disabled={disabled}
          aria-label={field.label}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === "") face.clear(field.path);
            else face.set(field.path, next);
          }}
        >
          <option value="">{t("tri.unset")}</option>
          {withCurrent(field.options, field.text).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </select>
      );
    case "list":
      return (
        <div {...stylingProps(styles.list)} data-field-control="list">
          {field.items.map((item) => (
            <div
              key={item.path.join(".")}
              {...stylingProps(styles.listRow)}
              data-list-item={item.index}
            >
              {item.options.length === 0 ? (
                <Input
                  data-field-control="text"
                  value={item.text}
                  disabled={disabled}
                  aria-label={field.label}
                  onChange={(event) => {
                    face.editText(item.path, event.currentTarget.value);
                  }}
                />
              ) : (
                <select
                  {...stylingProps(styles.select)}
                  data-field-control="select"
                  value={item.text}
                  disabled={disabled}
                  aria-label={field.label}
                  onChange={(event) => {
                    face.editText(item.path, event.currentTarget.value);
                  }}
                >
                  <option value="">{t("tri.unset")}</option>
                  {withCurrent(item.options, item.text).map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                      {option.label ?? String(option.value)}
                    </option>
                  ))}
                </select>
              )}
              <Button
                variant="outline"
                size="sm"
                data-action="remove-item"
                disabled={disabled}
                aria-label={t("list.remove")}
                onClick={() => {
                  face.removeItem(field.path, item.index);
                }}
              >
                <IconCloseOutlineRegular size={13} />
              </Button>
              {item.invalid === undefined ? null : (
                <p {...stylingProps(styles.invalid)} role="alert">
                  {item.invalid}
                </p>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            data-action="add-item"
            disabled={disabled}
            onClick={() => {
              face.appendItem(field.path);
            }}
          >
            <IconPlusOutlineRegular size={13} />
            {t("list.add")}
          </Button>
        </div>
      );
  }
}

// 候选里补上当前值：手写进去的名字（不在候选里）也要能在下拉里显示出来。
function withCurrent(
  options: BundleFieldView["options"],
  current: string,
): readonly { value: unknown; label?: string | undefined }[] {
  if (current === "" || options.some((option) => String(option.value) === current)) return options;
  return [{ value: current, label: current }, ...options];
}

function triValue(field: BundleFieldView): TriValue {
  return field.value === "unset" || field.value === "on" || field.value === "off"
    ? field.value
    : "unset";
}
