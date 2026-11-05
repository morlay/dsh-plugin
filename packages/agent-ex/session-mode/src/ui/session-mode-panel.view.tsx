// 右栏面板：这个会话**选中的模式**与它当下生效的那一份。
//
// 折叠组对齐上游右栏内容（20/24/40 内边距、整列滚动），一次只开一组；工具 / 技能 / policy 用
// 「默认 / 允许 / 禁止」三态切换（工具按组折叠、组内逐条）；每项标出来源（会话覆盖 / 模式默认）。
import { useEffect, useState, type ReactNode } from "react";
import { inject } from "@morlay/zephyr";
import { SlotView } from "@morlay/zephyr-app/client";
import {
  Button,
  IconChevronDownOutlineRegular,
  Menu,
  MenuItemButton,
  Modal,
  Row,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from "@morlay/zephyr-ui";
import { applyDraft, type ModeDraft } from "../endpoint/mode-config-rules.ts";
import type { ModeConfig } from "../endpoint/mode-config.ts";
import type {
  SessionModeActiveState,
  SessionModeDirectoryEntry,
  SessionModeTriState,
} from "../endpoint/session-mode-shapes.ts";
import { groupRef } from "../endpoint/tool-group-ref.ts";
import { PANEL_ID, SidebarRightPaneTabSlot } from "./session-mode-slots.ts";
import { SessionModeStore } from "./session-mode.store.ts";
import { viewPropsOf, type SessionModeViewProps } from "./view-props.ts";

// 右栏内容容器：整列滚动，20/24/40 的内边距。
const PANEL_STYLE = {
  height: "100%",
  overflowY: "auto",
  boxSizing: "border-box",
  padding: "20px 24px 40px",
} as const;

type SectionKey = "general" | "persona" | "tools" | "skills" | "policies";

// 三态之外还有「混合」：组里各条目的判定不一致时，组行没有单一档位可选。
type TriValue = "unset" | SessionModeTriState | "mixed";

// 草稿：本地改动先攒着，「应用到会话」时一次提交。
interface Draft {
  readonly switches: Readonly<Record<string, boolean | null>>;
  readonly items: Readonly<
    Record<"tools" | "skills" | "policies", Readonly<Record<string, "unset" | "allow" | "deny">>>
  >;
  readonly persona?: { readonly prefix: string; readonly suffix: string } | undefined;
}

const EMPTY_DRAFT: Draft = { switches: {}, items: { tools: {}, skills: {}, policies: {} } };

/** 右栏的会话模式面板。 */
@SlotView()
export class SessionModePanelView extends SidebarRightPaneTabSlot {
  private readonly store = inject(SessionModeStore);

  render(): ReactNode {
    const props = viewPropsOf(this.viewProps);
    return (
      <SessionModePanelBody
        sessionId={props.sessionId}
        store={this.store}
        useSessions={props.useSessions}
        panelId={PANEL_ID}
      />
    );
  }
}

interface PanelProps extends SessionModeViewProps {
  readonly store: SessionModeStore;
  readonly panelId: string;
}

export function SessionModePanelBody({ sessionId, store, panelId }: PanelProps): ReactNode {
  const [active, setActive] = useState<SessionModeActiveState | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<SectionKey | null>("general");
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  // 「应用到会话」右侧那半段的菜单开关。
  const [menuOpen, setMenuOpen] = useState(false);
  // 删除当前模式的二次确认。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (sessionId === undefined) {
      setError("当前没有会话");
      return;
    }
    let alive = true;
    setError(undefined);
    store.loadActive(sessionId).then(
      (value) => {
        if (alive) setActive(value);
      },
      (cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      alive = false;
    };
  }, [sessionId, store]);

  if (error !== undefined) {
    return (
      <div data-role="session-mode-panel" data-panel={panelId} style={PANEL_STYLE}>
        <Text as="p" size="sm" tone="danger">
          {error}
        </Text>
      </div>
    );
  }
  if (active === undefined) {
    return (
      <div data-role="session-mode-panel" data-panel={panelId} style={PANEL_STYLE}>
        <Text size="sm" tone="tertiary">
          读取中…
        </Text>
      </div>
    );
  }

  const effective =
    active.session === undefined ? active.config : { ...active.config, ...active.session };
  const overridden = new Set(active.overriddenFields);
  const source = (field: string): string => (overridden.has(field) ? "会话覆盖" : "模式默认");

  const draftOf = (): ModeDraft => ({
    lists: {
      tools: draft.items.tools,
      skills: draft.items.skills,
      policies: draft.items.policies,
    },
    ...(draft.persona === undefined ? {} : { persona: { ...draft.persona } }),
    switches: draft.switches,
  });

  // 草稿叠到生效配置上，得到「应用后会变成」的那一份（与宿主用同一个纯函数）。
  const viewConfig = (): ModeConfig => applyDraft(effective, draftOf(), active.config);

  const commit = (target: "session" | "config"): void => {
    if (sessionId === undefined) return;
    const config = viewConfig();
    const request =
      target === "session"
        ? store.applyConfig(sessionId, config)
        : store.saveConfig(sessionId, config);
    void request
      .then((value) => {
        setActive(value);
        setDraft(EMPTY_DRAFT);
        setNotice(target === "session" ? "已应用到会话" : "已保存，对新会话生效");
      })
      .catch((cause: unknown) => {
        setNotice(`保存失败: ${String(cause)}`);
      });
  };

  // 删掉会话上当前模式的自定义：服务端会把会话落回内置默认，所以删完再拉一次生效态。
  const removeCurrent = (): void => {
    if (sessionId === undefined) return;
    setConfirmingDelete(false);
    void store
      .remove(sessionId)
      .then(async (mode) => {
        setNotice(`已删除，会话回到「${mode}」`);
        setActive(await store.loadActive(sessionId));
        setDraft(EMPTY_DRAFT);
      })
      .catch((cause: unknown) => {
        setNotice(`删除失败: ${String(cause)}`);
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

  const toolGroups = new Map<string, SessionModeDirectoryEntry[]>();
  for (const entry of active.catalog.tools) {
    const group = entry.group ?? "其它";
    const list = toolGroups.get(group);
    if (list === undefined) toolGroups.set(group, [entry]);
    else list.push(entry);
  }

  const configValue = (entry: SessionModeDirectoryEntry): "unset" | SessionModeTriState => {
    if (entry.group !== undefined && effective.denyTools.includes(groupRef(entry.group)))
      return "deny";
    return entry.fallback === undefined || entry.fallback === "default" ? "unset" : entry.fallback;
  };

  return (
    <div data-role="session-mode-panel" data-panel={panelId} style={PANEL_STYLE}>
      <Stack gap="wide">
        <Stack gap={4}>
          <Text size="lg">{active.mode.name}</Text>
          <Text size="sm" tone="tertiary">
            {active.mode.description.length === 0 ? "（无说明）" : active.mode.description}
          </Text>
        </Stack>

        {section(
          "general",
          "通用配置",
          <Stack gap={6}>
            {(
              [
                ["instructions", "工作区指令", effective.instructions],
                ["skills", "技能目录", effective.skills],
                ["runtimeContext", "动态快照", effective.runtimeContext],
              ] as const
            ).map(([key, label, value]) => (
              <Row key={key} gap={6} align="center" justify="between">
                <Stack gap={2}>
                  <Text size="md">{label}</Text>
                  <Text size="sm" tone="tertiary">
                    {source(key)}
                  </Text>
                </Stack>
                <Switch
                  checked={draft.switches[key] ?? value}
                  label={label}
                  onChange={(next) => {
                    setDraft((prev) => ({ ...prev, switches: { ...prev.switches, [key]: next } }));
                  }}
                />
              </Row>
            ))}
          </Stack>,
        )}

        {section(
          "tools",
          `工具 (${String(active.catalog.tools.length)})`,
          <Stack gap={2}>
            {[...toolGroups].map(([group, entries]) => {
              const groupDraft = draft.items.tools[groupRef(group)];
              const values =
                groupDraft !== undefined
                  ? entries.map(() => groupDraft)
                  : entries.map(
                      (entry) =>
                        draft.items.tools[entry.id] ?? entry.override ?? configValue(entry),
                    );
              const uniform = values.every((value) => value === values[0]);
              const groupValue: TriValue = uniform ? (values[0] ?? "unset") : "mixed";
              return (
                <Stack key={group} gap={2}>
                  <TriStateRow
                    id={`${entries[0]?.groupLabel ?? group} (${String(entries.length)})`}
                    value={groupValue}
                    onLabelClick={() => {
                      setOpenGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group)) next.delete(group);
                        else next.add(group);
                        return next;
                      });
                    }}
                    onChange={(next) => {
                      setDraft((prev) => ({
                        ...prev,
                        items: {
                          ...prev.items,
                          tools: { ...prev.items.tools, [groupRef(group)]: next },
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
                          value={
                            draft.items.tools[entry.id] ?? entry.override ?? configValue(entry)
                          }
                          onChange={(next) => {
                            setDraft((prev) => ({
                              ...prev,
                              items: {
                                ...prev.items,
                                tools: { ...prev.items.tools, [entry.id]: next },
                              },
                            }));
                          }}
                        />
                      ))
                    : null}
                </Stack>
              );
            })}
          </Stack>,
        )}

        {section(
          "skills",
          `技能 (${String(active.catalog.skills.length)})`,
          <Stack gap={2}>
            {active.catalog.skills.map((entry) => (
              <TriStateRow
                key={entry.id}
                id={entry.id}
                description={entry.description}
                value={draft.items.skills[entry.id] ?? entry.override ?? configValue(entry)}
                onChange={(next) => {
                  setDraft((prev) => ({
                    ...prev,
                    items: {
                      ...prev.items,
                      skills: { ...prev.items.skills, [entry.id]: next },
                    },
                  }));
                }}
              />
            ))}
          </Stack>,
        )}

        {section(
          "policies",
          `政策规则 (${String(active.catalog.policies.length)})`,
          <Stack gap={2}>
            {active.catalog.policies.map((entry) => (
              <TriStateRow
                key={entry.id}
                id={entry.id}
                description={entry.description}
                value={draft.items.policies[entry.id] ?? entry.override ?? configValue(entry)}
                onChange={(next) => {
                  setDraft((prev) => ({
                    ...prev,
                    items: {
                      ...prev.items,
                      policies: { ...prev.items.policies, [entry.id]: next },
                    },
                  }));
                }}
              />
            ))}
          </Stack>,
        )}

        <Row gap={8} justify="end" align="center">
          <Button
            variant="outline"
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setNotice(null);
            }}
          >
            重置
          </Button>
          {/* 分体主按钮（与上游 header 的 `OpenTargetButton` 同一形状）：左半是主动作，右半是窄的 chevron，
              点开才是「保存为默认 / 另存为 / 删除」。两个半段贴在一起——内侧圆角归零、外侧保留。 */}
          <Row gap={0} align="center">
            <Button
              variant="primary"
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              onClick={() => {
                commit("session");
              }}
            >
              应用到会话
            </Button>
            <Menu
              open={menuOpen}
              align="end"
              anchor={
                <Button
                  variant="primary"
                  aria-label="更多保存方式"
                  style={{
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    paddingInline: 6,
                  }}
                  onClick={() => {
                    setMenuOpen(true);
                  }}
                >
                  <IconChevronDownOutlineRegular />
                </Button>
              }
              onClose={() => {
                setMenuOpen(false);
              }}
            >
              <MenuItemButton
                onSelect={() => {
                  setMenuOpen(false);
                  commit("config");
                }}
              >
                保存为默认
              </MenuItemButton>
              {/* 「另存为」要用户给新模式的 code / name（`store.saveAs` 的三个参数），那个输入面还没做。
                  禁用行必须给出**理由**（`disabledReason` 会读成该行的 description 并弹 tooltip），
                  否则用户只会当成 bug。 */}
              <MenuItemButton
                disabled
                disabledReason="需要先给新模式起名（暂未提供输入面）"
                onSelect={() => {}}
              >
                另存为
              </MenuItemButton>
              <MenuItemButton
                disabled={!active.deletable}
                {...(active.deletable
                  ? {}
                  : { disabledReason: "内置模式不能删除，只有会话上自定义过的模式可删" })}
                danger
                onSelect={() => {
                  setMenuOpen(false);
                  setConfirmingDelete(true);
                }}
              >
                删除
              </MenuItemButton>
            </Menu>
          </Row>
        </Row>

        {!confirmingDelete ? null : (
          <Modal
            open
            onClose={() => {
              setConfirmingDelete(false);
            }}
            title="删除当前模式"
            closeLabel="取消"
            description={`「${active.mode.name}」在会话上的自定义会被删除，会话回到内置默认模式。原模式本身不受影响。`}
            footer={
              <Row gap={8} justify="end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirmingDelete(false);
                  }}
                >
                  取消
                </Button>
                <Button variant="primary" tone="danger" onClick={removeCurrent}>
                  确认删除
                </Button>
              </Row>
            }
          />
        )}

        {notice === null ? null : (
          <Text as="p" size="sm" tone="tertiary">
            {notice}
          </Text>
        )}
      </Stack>
    </div>
  );
}

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
    <div
      data-role="section"
      data-section={title}
      style={{ borderTop: "1px solid var(--dsw-alias-border-l1)" }}
    >
      <button
        type="button"
        data-role="section-heading"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: 0,
          paddingBlock: 12,
          paddingInline: 0,
          font: "inherit",
          fontSize: 13,
          fontWeight: 500,
          color: "inherit",
          cursor: "pointer",
        }}
      >
        <span>{title}</span>
        <span data-role="section-icon" style={{ color: "var(--dsw-alias-label-tertiary)" }}>
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
  onChange,
  onLabelClick,
}: {
  readonly id: string;
  readonly description?: string | undefined;
  readonly value: TriValue;
  readonly indent?: number | undefined;
  readonly onChange: (next: "unset" | SessionModeTriState) => void;
  readonly onLabelClick?: (() => void) | undefined;
}): ReactNode {
  return (
    <div
      data-role="tri-state"
      data-id={id}
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
      <SegmentedControl<"unset" | "allow" | "deny" | "mixed">
        id={`tri-${id.replace(/[^a-zA-Z0-9_-]+/gu, "-")}`}
        label={id}
        value={value}
        options={
          value === "mixed"
            ? [
                { value: "mixed", label: "混合" },
                { value: "unset", label: "默认" },
                { value: "allow", label: "允许" },
                { value: "deny", label: "禁止" },
              ]
            : [
                { value: "unset", label: "默认" },
                { value: "allow", label: "允许" },
                { value: "deny", label: "禁止" },
              ]
        }
        onChange={(next) => {
          if (next === "mixed") return;
          onChange(next);
        }}
      />
    </div>
  );
}
