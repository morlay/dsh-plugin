// 右栏面板：这个会话**选中的模式**与它当下生效的那一份。折叠组对齐上游右栏内容（20/24/40 内边距、整列滚动），
// 手风琴一次只开一组；工具 / 技能 / policy 用"默认 / 允许 / 禁止"三态切换（工具按组折叠、组内逐条）；
// 每项标出来源（会话覆盖 / 模式默认），改动走会话级覆盖并立即重装收口。

import { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Input,
  Menu,
  Modal,
  MultilineField,
  Row,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from "@morlay/dsh-client-ui-primitives";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
// Type-only：拉入本包 host 半的投影声明（`sessionMode`）。
import type {} from "../index.ts";
// Type-only：右栏 tab 座位的声明。
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import { groupRef } from "../shared.ts";
import type {
  SessionModeActiveState,
  SessionModeDirectoryEntry,
  SessionModeTriState,
} from "../shared.ts";
import {
  deleteMode,
  fetchActive,
  saveAsNewMode,
  applySessionConfig,
  saveConfigDraft,
} from "./api.ts";

export type SessionModePanelProps = PropsRuntime<"sidebar.right.pane.tab"> &
  PropsLocale<"session-mode">;

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: SessionModeActiveState }
  | { readonly kind: "error"; readonly message: string };

type SectionKey = "general" | "persona" | "tools" | "skills" | "policies";

// 面板草稿：本地改动先攒着，"应用到会话"时一次提交。
interface Draft {
  switches: Record<string, boolean | null>;
  // 三态编辑的是**配置值**：`allow` / `deny` / `default`（配置里不写这一项）。
  items: Record<string, Record<string, "unset" | "allow" | "deny">>;
  persona?: { prefix: string; suffix: string } | null;
}
// 三态之外还有"混合"：组里各条目的判定不一致时，组行没有单一档位可选，只有它会出现，
// 且它自己不能再被选中——否则点"默认"会因为"已是当前值"而不回调，组里的禁止就清不掉。
type TriValue = "unset" | SessionModeTriState | "mixed";

// 上游右栏内容容器：整列滚动，20/24/40 的内边距。
const PANEL_STYLE = {
  height: "100%",
  overflowY: "auto",
  boxSizing: "border-box",
  padding: "20px 24px 40px",
} as const;

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  readonly title: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div style={{ borderTop: "1px solid var(--dsw-alias-border-l1)" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: 0,
          padding: "8px 0",
          font: "inherit",
          fontSize: 13,
          fontWeight: 500,
          color: "inherit",
          cursor: "pointer",
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 12, color: "var(--dsw-alias-label-tertiary)" }}>
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? (
        <div style={{ padding: "0 0 8px" }}>
          <Stack gap={6}>{children}</Stack>
        </div>
      ) : null}
    </div>
  );
}

function TriStateRow({
  id,
  description,
  value,
  indent = 0,
  t,
  onChange,
  onLabelClick,
}: {
  readonly id: string;
  readonly description?: string;
  readonly value: TriValue;
  readonly indent?: number;
  readonly t: SessionModePanelProps["t"];
  readonly onChange: (next: TriValue) => void;
  readonly onLabelClick?: () => void;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "6px 0",
        paddingLeft: indent,
      }}
    >
      <span
        style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 140px" }}
      >
        {onLabelClick === undefined ? (
          <Text size="sm">{id}</Text>
        ) : (
          <button
            type="button"
            onClick={onLabelClick}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              font: "inherit",
              fontSize: 13,
              color: "inherit",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            {id}
          </button>
        )}
        {description === undefined || description.length === 0 ? null : (
          <Text size="sm" tone="tertiary">
            {description}
          </Text>
        )}
      </span>
      <div style={{ maxWidth: "100%", marginLeft: "auto" }}>
        <SegmentedControl<"unset" | "allow" | "deny" | "mixed">
          id={`tri-${id.replace(/[^a-zA-Z0-9_-]+/gu, "-")}`}
          label={id}
          value={value as "unset" | "allow" | "deny" | "mixed"}
          options={
            value === "mixed"
              ? [
                  { value: "mixed", label: t("stateMixed") },
                  { value: "unset", label: t("stateDefault") },
                  { value: "allow", label: t("stateAllow") },
                  { value: "deny", label: t("stateDeny") },
                ]
              : [
                  { value: "unset", label: t("stateDefault") },
                  { value: "allow", label: t("stateAllow") },
                  { value: "deny", label: t("stateDeny") },
                ]
          }
          onChange={(next) => {
            if (next === "mixed") return;
            onChange(next as TriValue);
          }}
        />
      </div>
    </div>
  );
}

export function SessionModePanel({ sessionId, useSessions, t }: SessionModePanelProps) {
  const mode = useSessions((state) => {
    const value =
      sessionId === undefined ? undefined : state.byId[sessionId]?.projectionValues?.sessionMode;
    return typeof value === "string" ? value : undefined;
  });
  // preset 换了工具注册表也会换：把它一并作为重取的触发条件。
  const preset = useSessions((state) => {
    const value =
      sessionId === undefined ? undefined : state.byId[sessionId]?.projectionValues?.agentPreset;
    return typeof value === "string" ? value : undefined;
  });
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  // 草稿：本地改动先攒着，"应用到会话"时一次提交，避免每点一下都走一次请求 + 重装。
  const [draft, setDraft] = useState<Draft>({
    switches: {},
    items: { tools: {}, skills: {}, policies: {} },
  });
  const [dialog, setDialog] = useState<"saveAs" | "delete" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [openSection, setOpenSection] = useState<SectionKey | null>("general");
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (sessionId === undefined) {
      setLoad({ kind: "error", message: t("panelNoSession") });
      return;
    }
    let cancelled = false;
    setLoad({ kind: "loading" });
    void fetchActive(sessionId)
      .then((value) => {
        if (!cancelled) setLoad({ kind: "ready", value });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoad({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, mode, preset]);

  if (load.kind === "loading") {
    return (
      <div style={PANEL_STYLE}>
        <Text size="sm" tone="tertiary">
          {t("loading")}
        </Text>
      </div>
    );
  }
  if (load.kind === "error") {
    return (
      <div style={PANEL_STYLE}>
        <Text as="p" size="sm" tone="danger">
          {load.message}
        </Text>
      </div>
    );
  }

  const active = load?.kind === "ready" ? load.value : undefined;
  if (active === undefined || active === null) {
    return (
      <div style={PANEL_STYLE}>
        <Text size="sm" tone="tertiary">
          {t("loading")}
        </Text>
      </div>
    );
  }
  const overridden = new Set(active.overriddenFields);
  const source = (field: string): string =>
    overridden.has(field) ? t("fromSession") : t("fromMode");

  // 配置态的 "default"（没写这一项）在 UI 里统一叫 unset。
  const configValue = (entry: SessionModeDirectoryEntry): "unset" | "allow" | "deny" =>
    entry.fallback === undefined || entry.fallback === "default" ? "unset" : entry.fallback;

  const toolGroups = new Map<string, SessionModeDirectoryEntry[]>();
  for (const entry of active.catalog.tools) {
    const group = entry.group ?? "其它";
    const list = toolGroups.get(group);
    if (list === undefined) toolGroups.set(group, [entry]);
    else list.push(entry);
  }

  const toggleGroup = (group: string): void => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const section = (key: SectionKey, title: string, children: ReactNode): ReactNode => (
    <Section
      title={title}
      open={openSection === key}
      onToggle={() => {
        setOpenSection((current) => (current === key ? null : key));
      }}
    >
      {children}
    </Section>
  );

  return (
    <div style={PANEL_STYLE}>
      <Stack gap={0}>
        <Stack gap={4}>
          <Row gap={6} align="center">
            <Text size="lg">{active.mode.name}</Text>
            <Menu
              open={menuOpen}
              onClose={() => {
                setMenuOpen(false);
              }}
              align="end"
              portal
              items={[
                { id: "saveDefault", label: t("saveDefault") },
                { id: "saveAs", label: t("saveAs") },
                { id: "delete", label: t("delete"), disabled: !active.deletable },
              ]}
              onSelect={(id) => {
                setMenuOpen(false);
                if (id === "saveDefault") {
                  if (sessionId === undefined) return;
                  const modePatch: Record<string, unknown> = { ...draft.switches };
                  if (draft.persona !== undefined && draft.persona !== null) {
                    modePatch["persona"] = draft.persona;
                  }
                  const toItems = (values: Record<string, "unset" | "allow" | "deny">) =>
                    Object.fromEntries(
                      Object.entries(values).map(([entryId, value]) => [
                        entryId,
                        value === "unset" ? null : value,
                      ]),
                    );
                  void saveConfigDraft(sessionId, {
                    modePatch,
                    items: {
                      tools: toItems(draft.items["tools"] ?? {}),
                      skills: toItems(draft.items["skills"] ?? {}),
                      policies: toItems(draft.items["policies"] ?? {}),
                    },
                  })
                    .then((value) => {
                      setLoad({ kind: "ready", value });
                      setDraft({ switches: {}, items: { tools: {}, skills: {}, policies: {} } });
                      setNotice(t("saved"));
                    })
                    .catch((error: unknown) => setNotice(`${t("saveFailed")}: ${String(error)}`));
                  return;
                }
                if (id === "saveAs") {
                  setCode("");
                  setName(active.mode.name);
                  setDialog("saveAs");
                  return;
                }
                if (active.deletable) setDialog("delete");
              }}
              anchor={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => {
                    setMenuOpen((current) => !current);
                  }}
                >
                  …
                </Button>
              }
            />
          </Row>
          <Text size="sm" tone="tertiary">
            {active.mode.description.length === 0 ? t("empty") : active.mode.description}
          </Text>
        </Stack>
        <div style={{ height: 12 }} />

        {section(
          "general",
          t("general"),
          <>
            {(
              [
                ["instructions", t("instructions"), active.defaults.instructions],
                ["skills", t("skillsCatalog"), active.defaults.skills],
                ["runtimeContext", t("runtimeContext"), active.defaults.runtimeContext],
              ] as const
            ).map(([key, label, value]) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "4px 0",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <Text size="md">{label}</Text>
                  <Text size="sm" tone="tertiary">
                    {source(key)}
                  </Text>
                </span>
                <Row gap={6} style={{ marginLeft: "auto" }}>
                  {overridden.has(key) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDraft((prev): Draft => ({
                          ...prev,
                          switches: { ...prev.switches, [key]: null },
                        }));
                      }}
                    >
                      {t("stateDefault")}
                    </Button>
                  ) : null}
                  <div>
                    <Switch
                      checked={draft.switches[key] ?? value}
                      label={label}
                      onChange={(next) => {
                        setDraft((prev): Draft => ({
                          ...prev,
                          switches: { ...prev.switches, [key]: next },
                        }));
                      }}
                    />
                  </div>
                </Row>
              </div>
            ))}
          </>,
        )}

        {section(
          "persona",
          t("persona"),
          <>
            <Text size="sm" tone="tertiary">
              {source("persona")}
            </Text>
            <MultilineField
              value={draft.persona?.prefix ?? active.defaults.persona.prefix}
              rows={6}
              aria-label={t("persona")}
              onChange={(event) => {
                // 先取值：`setDraft` 的 updater 可能在事件派发之后才跑，那时 `currentTarget` 已是 null。
                const prefix = event.currentTarget.value;
                setDraft((prev): Draft => ({
                  ...prev,
                  persona: {
                    prefix,
                    suffix: prev.persona?.suffix ?? active.defaults.persona.suffix,
                  },
                }));
              }}
            />
            <MultilineField
              value={draft.persona?.suffix ?? active.defaults.persona.suffix}
              rows={3}
              aria-label={t("persona")}
              onChange={(event) => {
                const suffix = event.currentTarget.value;
                setDraft((prev): Draft => ({
                  ...prev,
                  persona: {
                    prefix: prev.persona?.prefix ?? active.defaults.persona.prefix,
                    suffix,
                  },
                }));
              }}
            />
          </>,
        )}

        {section(
          "tools",
          `${t("tools")} (${String(active.catalog.tools.length)})`,
          <>
            {[...toolGroups].map(([group, entries]) => {
              // 组引用草稿优先（组级三态写的就是这一条），否则按组内条目的一致性算。
              const groupDraft = draft.items["tools"]?.[groupRef(group)];
              const values =
                groupDraft !== undefined
                  ? entries.map(() => groupDraft)
                  : entries.map(
                      (entry) =>
                        draft.items["tools"]?.[entry.id] ?? entry.override ?? configValue(entry),
                    );
              const uniform = values.every((value) => value === values[0]);
              const groupValue: TriValue = uniform ? (values[0] ?? "unset") : "mixed";
              return (
                <Stack key={group} gap={2}>
                  <TriStateRow
                    id={`${entries[0]?.groupLabel ?? group} (${String(entries.length)})`}
                    t={t}
                    value={groupValue}
                    onLabelClick={() => {
                      toggleGroup(group);
                    }}
                    onChange={(next) => {
                      const value = next === "allow" || next === "deny" ? next : "unset";
                      setDraft((prev): Draft => ({
                        ...prev,
                        items: {
                          ...prev.items,
                          tools: { ...prev.items["tools"], [groupRef(group)]: value },
                        },
                      }));
                    }}
                  />
                  {openGroups.has(group)
                    ? entries.map((entry) => (
                        <TriStateRow
                          key={entry.id}
                          id={entry.id}
                          description={entry.description}
                          indent={16}
                          t={t}
                          value={
                            draft.items["tools"]?.[entry.id] ?? entry.override ?? configValue(entry)
                          }
                          onChange={(next) => {
                            const value = next === "allow" || next === "deny" ? next : "unset";
                            setDraft((prev): Draft => ({
                              ...prev,
                              items: {
                                ...prev.items,
                                tools: { ...prev.items["tools"], [entry.id]: value },
                              },
                            }));
                          }}
                        />
                      ))
                    : null}
                </Stack>
              );
            })}
          </>,
        )}

        {section(
          "skills",
          `${t("skills")} (${String(active.catalog.skills.length)})`,
          <>
            {active.catalog.skills.map((entry) => (
              <TriStateRow
                key={entry.id}
                id={entry.id}
                description={entry.description}
                t={t}
                value={draft.items["skills"]?.[entry.id] ?? entry.override ?? configValue(entry)}
                onChange={(next) => {
                  setDraft((prev): Draft => ({
                    ...prev,
                    items: {
                      ...prev.items,
                      skills: {
                        ...prev.items.skills,
                        [entry.id]: next === "allow" || next === "deny" ? next : "unset",
                      },
                    },
                  }));
                }}
              />
            ))}
          </>,
        )}

        {section(
          "policies",
          `${t("policies")} (${String(active.catalog.policies.length)})`,
          <>
            {active.catalog.policies.map((entry) => (
              <TriStateRow
                key={entry.id}
                id={entry.id}
                description={entry.description}
                t={t}
                value={draft.items["policies"]?.[entry.id] ?? entry.override ?? configValue(entry)}
                onChange={(next) => {
                  setDraft((prev): Draft => ({
                    ...prev,
                    items: {
                      ...prev.items,
                      policies: {
                        ...prev.items.policies,
                        [entry.id]: next === "allow" || next === "deny" ? next : "unset",
                      },
                    },
                  }));
                }}
              />
            ))}
          </>,
        )}

        <div style={{ height: 12 }} />
        <Row gap={8}>
          <Button
            variant="primary"
            onClick={() => {
              if (sessionId === undefined) return;
              const modePatch: Record<string, unknown> = { ...draft.switches };
              if (draft.persona !== undefined && draft.persona !== null) {
                modePatch["persona"] = draft.persona;
              }
              const items = {
                tools: Object.fromEntries(
                  Object.entries(draft.items["tools"] ?? {}).map(([id, value]) => [
                    id,
                    value === "unset" ? null : value,
                  ]),
                ),
                skills: Object.fromEntries(
                  Object.entries(draft.items["skills"] ?? {}).map(([id, value]) => [
                    id,
                    value === "unset" ? null : value,
                  ]),
                ),
                policies: Object.fromEntries(
                  Object.entries(draft.items["policies"] ?? {}).map(([id, value]) => [
                    id,
                    value === "unset" ? null : value,
                  ]),
                ),
              };
              void applySessionConfig(sessionId, { modePatch, items })
                .then((value) => {
                  setLoad({ kind: "ready", value });
                  setDraft({ switches: {}, items: { tools: {}, skills: {}, policies: {} } });
                  setNotice(t("applied"));
                })
                .catch((error: unknown) => setNotice(`${t("saveFailed")}: ${String(error)}`));
            }}
          >
            {t("apply")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDraft({ switches: {}, items: { tools: {}, skills: {}, policies: {} } });
              setNotice(null);
            }}
          >
            {t("reset")}
          </Button>
        </Row>
        {notice === null ? null : (
          <div style={{ paddingTop: 8 }}>
            <Text as="p" size="sm" tone="tertiary">
              {notice}
            </Text>
          </div>
        )}
      </Stack>

      <Modal
        open={dialog === "saveAs"}
        onClose={() => {
          setDialog(null);
        }}
        title={t("saveAs")}
        closeLabel={t("cancel")}
        footer={
          <Row gap={6}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDialog(null);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              disabled={code.trim().length === 0}
              onClick={() => {
                if (sessionId === undefined || code.trim().length === 0) return;
                void saveAsNewMode(sessionId, code, name)
                  .then(() => {
                    setDialog(null);
                    setNotice(t("savedNewMode"));
                  })
                  .catch((error: unknown) => setNotice(`${t("saveFailed")}: ${String(error)}`));
              }}
            >
              {t("confirm")}
            </Button>
          </Row>
        }
      >
        <Stack gap={6}>
          <Input
            value={code}
            placeholder={t("codePlaceholder")}
            aria-label={t("codeLabel")}
            onChange={(event) => {
              setCode(event.currentTarget.value);
            }}
          />
          <Input
            value={name}
            placeholder={t("namePlaceholder")}
            aria-label={t("nameLabel")}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
          />
        </Stack>
      </Modal>

      <Modal
        open={dialog === "delete"}
        onClose={() => {
          setDialog(null);
        }}
        title={t("delete")}
        closeLabel={t("cancel")}
        description={t("deleteConfirm")}
        footer={
          <Row gap={6}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDialog(null);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (sessionId === undefined) return;
                void deleteMode(sessionId)
                  .then((next) => {
                    setDialog(null);
                    setLoad({ kind: "ready", value: next });
                  })
                  .catch((error: unknown) => setNotice(`${t("saveFailed")}: ${String(error)}`));
              }}
            >
              {t("confirm")}
            </Button>
          </Row>
        }
      >
        <Text as="p" size="sm">
          {active.mode.name}
        </Text>
      </Modal>
    </div>
  );
}
