// 搬自 vendor/deepseek-harness/packages/client/ui-primitives/src/settings-form/fields.tsx
// （上游 `@deepseek-ai/dsh-client-ui-primitives`）：结构与行为同形，样式从 CSS Modules 换成包内 css-in-js。
// 上游用的 Tag 与 IconInfoOutlineRegular 没有一起搬——本包不依赖上游 primitives，用等价的本地徽标与图标。

import { useState, type ReactNode } from "react";
import { styled } from "../styling/styled.tsx";
import { styles } from "./fields.styles.ts";

const Field = styled("div")(styles.field);
const Head = styled("div")(styles.head);
const LabelGroup = styled("div")(styles.labelGroup);
const GroupLabel = styled("label")(styles.label, styles.groupLabel);
const HeadLabel = styled("label")(styles.label);
const HelpButton = styled("button")(styles.helpButton);
const Help = styled("div")(styles.help);
const Badges = styled("span")(styles.badges);
const NeutralBadge = styled("span")(styles.badge, styles.badgeNeutral);
const QuietBadge = styled("span")(styles.badge, styles.badgeQuiet);
const Reset = styled("button")(styles.reset);
const Input = styled("input")(styles.input);
const Invalid = styled("p")(styles.invalid);
const Hint = styled("p")(styles.hint);

/** 上游 icons 里的 IconInfoOutlineRegular（fill-only 几何，整份图标表不搬）。 */
function InfoGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12.5757 7.00012C12.5757 3.92085 10.0794 1.42463 7.00012 1.42456C3.9208 1.42456 1.42456 3.9208 1.42456 7.00012C1.42463 10.0794 3.92085 12.5757 7.00012 12.5757C10.0793 12.5756 12.5756 10.0793 12.5757 7.00012ZM13.8002 7.00012C13.8001 10.7559 10.7559 13.8001 7.00012 13.8002C3.2443 13.8002 0.199291 10.7559 0.199219 7.00012C0.199219 3.24426 3.24426 0.199219 7.00012 0.199219C10.7559 0.199291 13.8002 3.2443 13.8002 7.00012Z"
        fill="currentColor"
      />
      <path d="M7.6127 3.18921V4.55986H6.38735V3.18921H7.6127Z" fill="currentColor" />
      <path d="M7.6127 5.68921V10.8109H6.38735V5.68921H7.6127Z" fill="currentColor" />
    </svg>
  );
}

/** What every settings field control needs regardless of its value type. */
export interface SettingsFieldProps {
  /** Stable id associating the label with its control. */
  id: string;
  /** Visible label. */
  label: string;
  /** One-line explanation rendered under the control. */
  hint: string;
  /** Draft text this control renders. */
  text: string;
  /** True when saving would leave a user-layer entry for this field. */
  overridden: boolean;
  /** True when the draft is not a value this field accepts. */
  invalid: boolean;
  /** Copy for the overridden badge. */
  overriddenLabel: string;
  /** Copy for the reset control. */
  resetLabel: string;
  /** Copy shown in place of the hint while the draft is invalid. */
  invalidLabel: string;
  /** Disables every control (read-only document, or an unavailable namespace). */
  disabled: boolean;
  /** Stage draft text. */
  onEdit: (text: string) => void;
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void;
}

/**
 * A staged value field. `numeric` only hints the keypad: which drafts a field
 * accepts is decided by its spec, so the control never silently rewrites what
 * the user typed.
 * @param props - the field's copy, its staged text, and the edit actions.
 * @returns the labelled control.
 */
export function SettingsValueField(
  props: Omit<SettingsFieldProps, "hint"> & {
    /** Optional explanation shown below the input. */
    hint?: string;
    /** Rules disclosed by the information button beside the label. */
    help?: { label: string; content: ReactNode };
    /** Hints a numeric keypad without narrowing what the control accepts. */
    numeric?: boolean;
    /** Placeholder shown while the draft is empty. */
    placeholder?: string;
  },
) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = `${props.id}-help`;
  const messageId = `${props.id}-message`;
  const hasMessage = props.invalid || Boolean(props.hint);
  const description = [hasMessage ? messageId : "", helpOpen ? helpId : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <Field>
      <Head>
        <LabelGroup>
          <GroupLabel htmlFor={props.id}>{props.label}</GroupLabel>
          {props.help !== undefined ? (
            <HelpButton
              type="button"
              aria-label={props.help.label}
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => {
                setHelpOpen(!helpOpen);
              }}
            >
              <InfoGlyph size={12} />
            </HelpButton>
          ) : null}
        </LabelGroup>
        {props.overridden ? (
          <Badges>
            <NeutralBadge>{props.overriddenLabel}</NeutralBadge>
            <Reset type="button" disabled={props.disabled} onClick={props.onReset}>
              {props.resetLabel}
            </Reset>
          </Badges>
        ) : null}
      </Head>
      <Input
        id={props.id}
        type="text"
        {...(props.numeric === true ? { inputMode: "numeric" as const } : {})}
        {...(props.invalid ? { "aria-invalid": true } : {})}
        aria-describedby={description || undefined}
        value={props.text}
        placeholder={props.placeholder ?? ""}
        disabled={props.disabled}
        onChange={(event) => {
          props.onEdit(event.target.value);
        }}
      />
      {hasMessage ? (
        props.invalid ? (
          <Invalid id={messageId}>{props.invalidLabel}</Invalid>
        ) : (
          <Hint id={messageId}>{props.hint}</Hint>
        )
      ) : null}
      {props.help !== undefined && helpOpen ? (
        <Help id={helpId} role="region" aria-label={props.help.label}>
          {props.help.content}
        </Help>
      ) : null}
    </Field>
  );
}

/**
 * A write-only credential control. The value never rides a response, so the
 * control reports only whether one is configured and starts blank; a blank
 * draft writes nothing, which keeps the stored key rather than clearing it.
 * @param props - the field's copy, its staged text, and the configured state.
 * @returns the labelled control.
 */
export function SettingsSecretField(
  props: Pick<SettingsFieldProps, "id" | "label" | "hint" | "text" | "disabled" | "onEdit"> & {
    /** Whether the Host reports a configured credential for this reference. */
    configured: boolean;
    /** Copy describing the configured state. */
    stateLabel: string;
  },
) {
  const Badge = props.configured ? NeutralBadge : QuietBadge;
  return (
    <Field>
      <Head>
        <HeadLabel htmlFor={props.id}>{props.label}</HeadLabel>
        <Badges>
          <Badge>{props.stateLabel}</Badge>
        </Badges>
      </Head>
      <Input
        id={props.id}
        type="password"
        autoComplete="off"
        value={props.text}
        disabled={props.disabled}
        onChange={(event) => {
          props.onEdit(event.target.value);
        }}
      />
      <Hint>{props.hint}</Hint>
    </Field>
  );
}
