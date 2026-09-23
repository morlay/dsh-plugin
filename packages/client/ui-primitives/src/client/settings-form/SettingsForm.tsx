// 搬自 vendor/deepseek-harness/packages/client/ui-primitives/src/settings-form/SettingsForm.tsx
// （上游 `@deepseek-ai/dsh-client-ui-primitives`）：行为同形，样式从 CSS Modules 换成包内 css-in-js。

import { useEffect, useRef, type ReactNode } from "react";
import { styled } from "../styling/styled.tsx";
import type { SettingsFormShell } from "./form-model.ts";
import { styles } from "./SettingsForm.styles.ts";

const Form = styled("div")(styles.form);
const Notice = styled("p")(styles.notice);
const Footer = styled("div")(styles.footer);
const Failed = styled("p")(styles.failed);
const Save = styled("button")(styles.save);

/** The copy the form frame renders, from the owning plugin's dictionary. */
export interface SettingsFormLabels {
  /** Shown in place of the controls while the namespace is not served. */
  unavailable: string;
  /** Shown over the controls while the document is read-only. */
  readOnly: string;
  /** Shown beside the save after a save the Host did not accept. */
  saveFailed: string;
  /** The save control. */
  save: string;
  /** The save control while a save is crossing the wire. */
  saving: string;
}

/** Form chrome shared by every settings page. */
export interface SettingsFormProps {
  /** The frame's copy. */
  labels: SettingsFormLabels;
  /** The form state: availability, writability, and what a save would do. */
  state: SettingsFormShell;
  /** Write every staged edit. */
  onSave: () => void;
  /** Drop every staged edit; the form calls it when it leaves the page. */
  onDiscard: () => void;
  /** The plugin's controls. */
  children: ReactNode;
}

/**
 * Render one plugin's settings form.
 * @param props - the form's copy and state, its controls, and the save and discard actions.
 * @returns the form, or the unavailable line while the namespace is not served.
 */
export function SettingsForm(props: SettingsFormProps) {
  const { state, labels } = props;
  const discard = useRef(props.onDiscard);
  discard.current = props.onDiscard;
  useEffect(
    () => () => {
      discard.current();
    },
    [],
  );
  if (!state.available) return <Notice role="status">{labels.unavailable}</Notice>;
  const blocked = !state.dirty || state.invalid || state.saving;
  return (
    <Form>
      {!state.writable ? <Notice role="status">{labels.readOnly}</Notice> : null}
      {props.children}
      <Footer>
        {state.failed ? <Failed role="status">{labels.saveFailed}</Failed> : null}
        <Save type="button" disabled={blocked} onClick={props.onSave}>
          {state.saving ? labels.saving : labels.save}
        </Save>
      </Footer>
    </Form>
  );
}
