/**
 * 一行的配置页：官方表单壳（保存 / 丢弃 / 只读 / 不可用）+ 行式 JSON 结构编辑器 + 字段槽。
 *
 * 每个可渲染的行注册项经 `renderFactorySlot('settings.schema-form.form', …)` 渲染这个 Factory，字段槽因此只需在
 * Factory 的 `children` 里声明一次（slots 的 children 声明 per key 唯一，而本包给每个行都注册了一项）。
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { SettingsForm, type SettingsFormLabels } from "@deepseek-ai/dsh-client-ui-primitives";
import { Editor } from "./Editor.tsx";
import { parseFor } from "./fields.tsx";
import type { SchemaFieldOwnerProps, SchemaFormComponentProps } from "./slot-contract.ts";
import { Hint } from "./styles.ts";
import { SchemaFieldDefault } from "./value.tsx";

/**
 * 渲染一行的配置页。
 * @param props - 行 id、控制器面、本地化解析与框架注入的槽位渲染座位。
 * @returns 表单壳里的行式编辑器，或「没有可自动生成的配置项」一行。
 */
export function SchemaForm(props: SchemaFormComponentProps): ReactNode {
  const { ns, face, t, resolveText, renderSlotChain } = props;
  const store = face.hooks.schemaForm;
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
  );
  const labels: SettingsFormLabels = {
    unavailable: t("unavailable"),
    readOnly: t("readOnly"),
    saveFailed: t("saveFailed"),
    save: t("save"),
    saving: t("saving"),
  };
  if (!state.configured) return <Hint role="status">{t("noSchema")}</Hint>;
  return (
    <SettingsForm
      labels={labels}
      state={state}
      onSave={() => {
        face.save();
      }}
      onDiscard={() => {
        face.discard();
      }}
    >
      <Editor
        ns={ns}
        state={state}
        face={face}
        t={t}
        resolveText={resolveText}
        renderField={(owner: SchemaFieldOwnerProps) =>
          renderSlotChain("settings.schema-form.field", owner, {
            fallback: <SchemaFieldDefault owner={{ ...owner, onEditText: withParse(owner, t) }} />,
          })
        }
      />
    </SettingsForm>
  );
}

/** 文本草稿的解析规则按字段类型给：行内编辑只上报原文，值在保存那一刻成形。 */
function withParse(
  owner: SchemaFieldOwnerProps,
  t: SchemaFormComponentProps["t"],
): SchemaFieldOwnerProps["onEditText"] {
  return (text, parse) => {
    owner.onEditText(text, parse ?? parseFor(owner.node, t));
  };
}
