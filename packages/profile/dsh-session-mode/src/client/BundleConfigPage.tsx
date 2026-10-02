// bundle 配置页：装这个 bundle 的那一行（`session-mode`）的完整配置——新会话的默认模式 + 每个模式一张可折叠卡片。
//
// 注册进 `plugins.bundle.config`（key = bundle 包名），读写的命名空间是 `session-mode`。草稿、整段校验与保存都归通用
// schema 表单的控制器（`bundle-config.ts` 的注入面），本文件只管布局与装配：**控件一律从
// `@morlay/dsh-client-ui-primitives/client` 取**（它转出官方那套基础组件，并给出这套设置面自有的控件——
// 字段行 `SettingsFieldRow`、可搜索选择器 `SearchSelect`、标签输入 `TagInput`、多行文本 `MultilineField`、图标按钮
// `IconButton`），这一页自己的样式只剩结构布局。改动一律先落草稿，底部保存是唯一写盘点。

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  DisclosureRow,
  IconAgentPresetOutlineRegular,
  IconButton,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Modal,
  ModelRouteList,
  MultilineField,
  SegmentedControl,
  SearchSelect,
  SettingsFieldRow,
  SettingsForm,
  Switch,
  TagInput,
  type SettingsFormLabels,
} from "@morlay/dsh-client-ui-primitives/client";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { SchemaFormState } from "@morlay/dsh-client-ui-primitives/client";
import {
  SESSION_MODE_NS,
  projectBundleConfig,
  ROLES,
  type BundleConfigActions,
  type BundleConfigFace,
  type ConfigStatus,
  type BundleFieldView,
  type BundleModeView,
  type BundleModelsState,
  type BundleTranslate,
} from "./bundle-config.ts";
import { routeKey } from "./llm-directory.ts";
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
  // 读数取原始快照（引用稳定，uSES 语义正确），投影在渲染里做。
  const snapshot = props.useBundleConfig((current: SchemaFormState) => current);
  const status = props.useBundleStatus((current: ConfigStatus) => current);
  const models = props.useBundleModels((current: BundleModelsState) => current);
  const state = useMemo(() => projectBundleConfig(snapshot, t, status), [snapshot, t, status]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [addingId, setAddingId] = useState("");
  // "添加模式"的弹窗：由"模式"标题右边那个 + 图标按钮打开。
  const [addingOpen, setAddingOpen] = useState(false);
  // 要删的那个模式：删除是不可逆的一步，先过一次确认弹窗（保存之前仍可丢弃）。
  const [removing, setRemoving] = useState<BundleModeView | null>(null);
  // 挂载时强制重读一次 describe：视图晚到、通知没落上时，这一步把读数拉平（有草稿时它自己跳过）。
  const resync = props.resync;
  useEffect(() => {
    resync();
  }, [resync]);
  // 槽位注册项只为 `page` 视图存在（bundle 页不给 `summary` 座位）。
  if (view !== "page") return null;
  if (state.readiness !== "ready") {
    // 只有异常态才做诊断（它读 describe 与 schema，正常路径一次也不跑）。
    const diagnosis = props.diagnose();
    const message =
      state.readiness === "loading"
        ? t("configured.loading")
        : state.readiness === "missing"
          ? t("configured.missing")
          : t("configured.unreadable", { problem: diagnosis.problem });
    return (
      <div data-bundle-config={state.readiness} data-namespace={SESSION_MODE_NS}>
        <p
          {...stylingProps(styles.hint)}
          data-namespaces={diagnosis.namespaces.join(",")}
          data-problem={diagnosis.problem}
          data-controller={diagnosis.controller}
        >
          {message}
        </p>
        {state.readiness !== "unreadable" ? null : (
          // 读不出来时把诊断也画出来：这时页面本来就用不了，原因说在明面上比藏在属性里有用。
          <p {...stylingProps(styles.diagnosis)} data-diagnosis="true">
            {`${diagnosis.problem} · ${diagnosis.controller} · namespaces=[${diagnosis.namespaces.join(", ")}]`}
          </p>
        )}
      </div>
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
          <SettingsFieldRow
            label={t("default.label")}
            hint={t("default.hint")}
            layout="inline"
            {...(state.defaultMode.invalid === undefined ? {} : { invalid: state.defaultMode.invalid })}
            data-field="default"
            data-control="choice"
          >
            <SearchSelect
              label={t("default.label")}
              value={state.defaultMode.value}
              emptyLabel={t("tri.unset")}
              options={state.defaultMode.options.map((option) => ({
                value: String(option.value),
                ...(option.label === undefined ? {} : { label: option.label }),
              }))}
              searchLabel={t("select.search")}
              noMatchLabel={t("select.noMatch")}
              disabled={!state.writable}
              onSelect={(next) => {
                if (next === "") face.clear(["default"]);
                else face.set(["default"], next);
              }}
            />
          </SettingsFieldRow>
        </section>

        <section {...stylingProps(styles.section)} data-section="modes">
          {/* 这一段的第一个 child 是 `row(col(标题, 说明), 控件)`：左列标题与说明同列，添加入口贴最右。 */}
          <div {...stylingProps(styles.sectionHead)}>
            <span {...stylingProps(styles.sectionHeadText)}>
              <h4 {...stylingProps(styles.sectionTitle)}>{t("modes.label")}</h4>
              <p {...stylingProps(styles.hint)}>{t("modes.hint")}</p>
            </span>
            <IconButton
              label={t("add.label")}
              data-action="open-add-mode"
              disabled={!state.writable}
              onClick={() => {
                setAddingId("");
                setAddingOpen(true);
              }}
            >
              <IconPlusOutlineRegular />
            </IconButton>
          </div>
          {state.modes.map((mode) => (
            <ModeCard
              key={mode.id}
              mode={mode}
              models={models}
              open={expanded.has(mode.id)}
              writable={state.writable}
              t={t}
              face={face}
              onRequestRemove={() => {
                setRemoving(mode);
              }}
              onToggle={() => {
                toggle(mode.id);
              }}
            />
          ))}
        </section>
      </div>
      <Modal
        open={addingOpen}
        onClose={() => {
          setAddingOpen(false);
        }}
        title={t("add.label")}
        closeLabel={t("add.close")}
        description={t("add.hint")}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setAddingOpen(false);
              }}
            >
              {t("add.cancel")}
            </Button>
            <Button
              variant="primary"
              data-action="add-mode"
              disabled={addingId.trim() === ""}
              onClick={() => {
                const id = addingId.trim();
                face.addMode(id);
                setAddingId("");
                setAddingOpen(false);
                setExpanded((previous) => new Set(previous).add(id));
              }}
            >
              {t("add.confirm")}
            </Button>
          </>
        }
      >
        <Input
          data-field="new-mode"
          data-modal-autofocus
          value={addingId}
          placeholder={t("add.placeholder")}
          aria-label={t("add.label")}
          onChange={(event) => {
            setAddingId(event.currentTarget.value);
          }}
        />
      </Modal>
      <Modal
        open={removing !== null}
        onClose={() => {
          setRemoving(null);
        }}
        title={t("remove.title")}
        closeLabel={t("remove.close")}
        description={t("remove.description", { name: removing?.title ?? "" })}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setRemoving(null);
              }}
            >
              {t("remove.cancel")}
            </Button>
            <Button
              variant="primary"
              className={className(styles.dangerFill)}
              data-action="confirm-remove"
              onClick={() => {
                if (removing !== null) face.removeMode(removing.id);
                setRemoving(null);
              }}
            >
              {t("remove.confirm")}
            </Button>
          </>
        }
      />
    </SettingsForm>
  );
}

// 一张模式卡片：折叠头显示名称与摘要，展开后是分组字段与删除入口。
function ModeCard({
  mode,
  models,
  open,
  writable,
  t,
  face,
  onRequestRemove,
  onToggle,
}: {
  mode: BundleModeView;
  // 部署里"已设置的模型"（默认模型那一组的清单用它）。
  models: BundleModelsState;
  open: boolean;
  writable: boolean;
  t: BundleTranslate;
  face: BundleConfigActions;
  // 删除要过确认弹窗：卡片只上报"想删这一个"，真正删谁由页面在弹窗里定。
  onRequestRemove: () => void;
  onToggle: () => void;
}): ReactNode {
  const hasModel = mode.model !== undefined;
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
        keepContentWhenOpen
        contentClassName={className(styles.disclosureRoot)}
        contentLayoutClassName={className(styles.disclosureContent)}
        collapsedContent={
          // 两段：先是紧挨名称的 id，再是贴最右的摘要 + 删除。
          <>
            <code {...stylingProps(styles.modeId)} data-mode-id>
              {mode.id}
            </code>
            <span {...stylingProps(styles.modeHeadAside)}>
              <span {...stylingProps(styles.modeSummary)}>{mode.summary}</span>
              {mode.deletable ? (
                <IconButton
                  data-action="remove-mode"
                  disabled={!writable}
                  label={t("removeNamed", { name: mode.title })}
                  onClick={(event) => {
                    // 行本身是折叠开关：删除先拦下这次点击，别顺手把卡片收起来（确认弹窗照旧）。
                    event.stopPropagation();
                    onRequestRemove();
                  }}
                >
                  <IconTrashOutlineRegular />
                </IconButton>
              ) : (
                <span {...stylingProps(styles.protectedNote)} data-protected="true">
                  {t("protected")}
                </span>
              )}
            </span>
          </>
        }
      >
        <div {...stylingProps(styles.modeBody)}>
          {mode.groups.map((group) => (
            <div key={group.key} {...stylingProps(styles.group)} data-group={group.key}>
              <div {...stylingProps(styles.groupHead)}>
                <span {...stylingProps(styles.groupTitle)}>{group.label}</span>
              </div>
              {group.key === "model" ? (
                <>
                  {/* 整块 `defaultModel` 是一个可加字段：开关开 = 这个模式自带默认模型，关 = 跟随全局。 */}
                  <SettingsFieldRow
                    label={t("field.defaultModel")}
                    hint={t("hint.defaultModel")}
                    layout="inline"
                    data-control="default-model"
                  >
                    <Switch
                      checked={hasModel}
                      label={t("field.defaultModel")}
                      disabled={!writable}
                      onChange={(next) => {
                        if (next) {
                          face.set(["modes", mode.id, "defaultModel"], { provider: "", model: "" });
                        } else {
                          face.clear(["modes", mode.id, "defaultModel"]);
                        }
                      }}
                    />
                  </SettingsFieldRow>
                  {!hasModel ? null : (
                    <SettingsFieldRow
                      label={t("field.modelRoute")}
                      hint={t("hint.modelRoute")}
                      divider
                      data-control="model-routes"
                    >
                      <ModelRouteList
                        label={t("field.modelRoute")}
                        candidates={models.routes}
                        selectedKey={
                          mode.model === undefined || mode.model.provider === ""
                            ? undefined
                            : routeKey(mode.model.provider, mode.model.model)
                        }
                        disabled={!writable}
                        status={models.status}
                        loadingLabel={t("model.loading")}
                        errorLabel={t("model.error")}
                        emptyLabel={t("model.empty")}
                        onSelect={(candidate) => {
                          // 服务商与模型是一对：选一条路由等于把两个字段一起定下来。
                          face.set(["modes", mode.id, "defaultModel"], {
                            provider: candidate.provider,
                            model: candidate.model,
                          });
                        }}
                      />
                    </SettingsFieldRow>
                  )}
                  {group.fields.map((field, index) => (
                    <FieldRow
                      key={field.key}
                      field={field}
                      writable={writable}
                      t={t}
                      face={face}
                      divider={index > 0 || hasModel}
                    />
                  ))}
                </>
              ) : (
                group.fields.map((field, index) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    writable={writable}
                    t={t}
                    face={face}
                    divider={index > 0}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      </DisclosureRow>
    </div>
  );
}

// 一个字段：位置（标签 / 说明 / 徽标 / 分隔线）归 `SettingsFieldRow`，控件本体归 `FieldControl`。
function FieldRow({
  field,
  writable,
  divider,
  t,
  face,
}: {
  field: BundleFieldView;
  writable: boolean;
  // 不是这一组的第一个字段：与上一个之间画一条细分隔线（与官方设置面同一种口径）。
  divider: boolean;
  t: BundleTranslate;
  face: BundleConfigActions;
}): ReactNode {
  // 选项类字段要有候选才画：候选按字段树里的路径给，`defaultModel` 整块没配时它的子字段不在树上，
  // 这时画出来只会是一个没有可选值的空选择器（"设置默认模型"按钮才是那个状态下的入口）。
  if (field.control === "choice" && !field.present) return null;
  return (
    <SettingsFieldRow
      label={field.label}
      hint={field.hint}
      divider={divider}
      // 开关 / 三态 / 多选按钮这一类是"右置排"：标签与说明在左，控件贴最右（官方设置页的开关行同一种）。
      layout={
        field.control === "switch" || field.control === "tri" || field.control === "roles"
          ? "inline"
          : "stack"
      }
      {...(field.overridden ? { overriddenLabel: t("overridden") } : {})}
      {...(field.control === "text"
        ? {
            resetLabel: t("field.reset"),
            onReset: () => {
              face.clear(field.path);
            },
          }
        : {})}
      {...(field.invalid === undefined ? {} : { invalid: field.invalid })}
      data-field={field.path.join(".")}
      data-control={field.control}
    >
      <FieldControl field={field} writable={writable} t={t} face={face} />
    </SettingsFieldRow>
  );
}

function FieldControl({
  field,
  writable,
  t,
  face,
}: {
  field: BundleFieldView;
  writable: boolean;
  t: BundleTranslate;
  face: BundleConfigActions;
}): ReactNode {
  const disabled = !writable;
  const id = useId();
  switch (field.control) {
    case "multiline":
      return (
        <MultilineField
          value={field.text}
          rows={3}
          disabled={disabled}
          aria-label={field.label}
          onChange={(event) => {
            face.editText(field.path, event.currentTarget.value);
          }}
        />
      );
    case "choice":
      return (
        <SearchSelect
          label={field.label}
          value={field.text}
          emptyLabel={t("tri.unset")}
          options={field.options.map((option) => ({
            value: String(option.value),
            ...(option.label === undefined ? {} : { label: option.label }),
          }))}
          searchLabel={t("select.search")}
          noMatchLabel={t("select.noMatch")}
          disabled={disabled}
          onSelect={(next) => {
            if (next === "") face.clear(field.path);
            else face.set(field.path, next);
          }}
        />
      );
    case "switch":
      return (
        <Switch
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
          id={`${id}-tri`}
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
        <div {...stylingProps(styles.roles)} data-control="roles">
          {ROLES.map((role) => {
            const active = Array.isArray(field.value) && field.value.includes(role);
            return (
              <Button
                key={role}
                variant={active ? "primary" : "outline"}
                size="sm"
                // `data-role` 归控件身份（见 primitives 的控件），这一处标的是"哪个模式角色"，所以另起一个名字。
                data-mode-role={role}
                disabled={disabled}
                aria-pressed={active}
                onClick={() => {
                  const current = Array.isArray(field.value) ? field.value.map(String) : [];
                  const wanted = active
                    ? current.filter((value) => value !== role)
                    : [...current.filter((value) => value !== role), role];
                  face.set(field.path, wanted);
                }}
              >
                {t(`role.${role}` as "role.main")}
              </Button>
            );
          })}
        </div>
      );
    case "tags":
      return (
        <TagInput
          value={Array.isArray(field.value) ? field.value.map(String) : []}
          options={field.options.map((option) => ({
            value: String(option.value),
            ...(option.label === undefined ? {} : { label: option.label }),
          }))}
          placeholder={t("tags.placeholder")}
          label={field.label}
          candidatesLabel={t("tags.candidates")}
          searchLabel={t("select.search")}
          noMatchLabel={t("select.noMatch")}
          removeLabel={(name) => t("tags.remove", { name })}
          disabled={disabled}
          onChange={(next) => {
            face.set(field.path, next);
          }}
        />
      );
    case "text":
      return (
        <Input
          value={field.text}
          aria-label={field.label}
          disabled={disabled}
          onChange={(event) => {
            face.editText(field.path, event.currentTarget.value);
          }}
        />
      );
  }
}

function triValue(field: BundleFieldView): TriValue {
  return field.value === "unset" || field.value === "on" || field.value === "off"
    ? field.value
    : "unset";
}
