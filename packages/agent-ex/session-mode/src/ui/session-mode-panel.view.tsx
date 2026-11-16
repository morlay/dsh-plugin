// 右栏面板：这个会话**选中的模式**与它当下生效的那一份。
//
// 折叠组对齐上游右栏内容（20/24/40 内边距、整列滚动），一次只开一组；工具 / 技能 / policy 用
// 「默认 / 允许 / 禁止」三态切换（工具按组折叠、组内逐条）；每项标出来源（会话覆盖 / 模式默认），
// 被覆盖的项旁给「恢复默认」——它发的是 `setModePatch(id, null)`，只清这个字段的会话覆盖。
import { useEffect, useState, type ReactNode } from "react";
import { inject } from "@morlay/zephyr";
import { SlotView } from "@morlay/zephyr-app/client";
import {
  Button,
  IconChevronDownOutlineRegular,
  Menu,
  MenuItemButton,
  Modal,
  MultilineField,
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
import { zh, type SessionModeLocaleKey } from "./locales.ts";
import {
  SessionModeLocales,
  type SessionModeTranslate,
} from "./session-mode-locales.contribution.ts";
import { PANEL_ID, SidebarRightPaneTabSlot } from "./session-mode-slots.ts";
import { SessionModeStore } from "./session-mode.store.ts";
import { viewPropsOf, type SessionModeViewProps } from "./view-props.ts";

// 名单字段按「工具 / 技能 / policy」三对归拢：条目的「恢复默认」要清的是它所在的那一份名单。
const LIST_FIELDS = {
  tools: { allow: "allowTools", deny: "denyTools" },
  skills: { allow: "allowSkills", deny: "denySkills" },
  policies: { allow: "allowPolicies", deny: "denyPolicies" },
} as const;

// 失败原因：`Error` 取 message，其它（wire 上常是字符串）直接转。
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// 纯展示组件在测试里也是直接渲染的（不经容器），所以翻译座缺省取中文那份字典：
// 装配期由容器注入 `locales.t()`，单测里不装 Locale 服务也有文案。
const fallbackTranslate: SessionModeTranslate = (key: SessionModeLocaleKey) => zh[key];

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

  private readonly locales = inject(SessionModeLocales);

  render(): ReactNode {
    const props = viewPropsOf(this.viewProps);
    return (
      <SessionModePanelBody
        sessionId={props.sessionId}
        store={this.store}
        useSessions={props.useSessions}
        panelId={PANEL_ID}
        t={this.locales.t()}
      />
    );
  }
}

interface PanelProps extends SessionModeViewProps {
  readonly store: SessionModeStore;
  readonly panelId: string;
  // 翻译座：容器（`SessionModePanelView`）从装配里取，纯展示组件只按它出文案。
  readonly t?: SessionModeTranslate | undefined;
}

export function SessionModePanelBody({
  sessionId,
  store,
  panelId,
  t = fallbackTranslate,
}: PanelProps): ReactNode {
  const [active, setActive] = useState<SessionModeActiveState | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<SectionKey | null>("general");
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  // 「只看可调用」：打开后工具列表只留没被 deny、且属于本会话可见集合的条目。
  const [onlyCallable, setOnlyCallable] = useState(false);
  // 「应用到会话」右侧那半段的菜单开关。
  const [menuOpen, setMenuOpen] = useState(false);
  // 删除当前模式的二次确认。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // `t` 不在依赖里：容器每次 render 都会 `bind` 出一个新函数，进依赖会把 effect 变成每次渲染都重拉。
  // 它的**返回值**只跟当前语言走，语言的切换由上游整页刷新处理。
  useEffect(() => {
    if (sessionId === undefined) return;
    let alive = true;
    setError(undefined);
    store.loadActive(sessionId).then(
      (value) => {
        if (alive) setActive(value);
      },
      (cause: unknown) => {
        if (alive) setError(messageOf(cause));
      },
    );
    return () => {
      alive = false;
    };
  }, [sessionId, store]);

  // 三种「还没读到」的态各占整块：没有会话 / 读失败 / 正在读。读失败不能伪装成空列表或一直转圈。
  if (sessionId === undefined) {
    return (
      <div data-role="session-mode-panel" data-panel={panelId} style={PANEL_STYLE}>
        <Text size="sm" tone="tertiary">
          {t("panelNoSession")}
        </Text>
      </div>
    );
  }
  if (error !== undefined) {
    return (
      <div data-role="session-mode-panel" data-panel={panelId} style={PANEL_STYLE}>
        <div data-role="panel-error" role="alert">
          <Text as="p" size="sm" tone="danger">
            {`${t("loadFailed")}: ${error}`}
          </Text>
        </div>
      </div>
    );
  }
  if (active === undefined) {
    return (
      <div data-role="session-mode-panel" data-panel={panelId} style={PANEL_STYLE}>
        <Text size="sm" tone="tertiary">
          {t("loading")}
        </Text>
      </div>
    );
  }

  const effective =
    active.session === undefined ? active.config : { ...active.config, ...active.session };
  const overridden = new Set(active.overriddenFields);
  const source = (field: string): string =>
    overridden.has(field) ? t("fromSession") : t("fromMode");

  // 逐字段回退：`null` 在宿主的语义是「清掉这个字段的会话覆盖，回到模式默认」，其余字段不动。
  //
  // 粒度就是 `ModeConfig` 的字段（与 `overriddenFields` 同名）：一个工具条目回退清的是它所在的那对
  // 名单字段——这是宿主的补丁能表达的最小粒度，条目级的「只回到默认这一条」在写面没有对应语义。
  const restore = (fields: readonly string[]): void => {
    if (sessionId === undefined) return;
    const patch: Record<string, null> = {};
    for (const field of fields) patch[field] = null;
    void store
      .patch(sessionId, patch)
      .then((value) => {
        setActive(value);
        // 这些字段上的本地草稿跟着作废：它们不再是「待提交的改动」，而是回到了模式默认。
        setDraft((prev) => {
          const switches = { ...prev.switches };
          const items = {
            tools: { ...prev.items.tools },
            skills: { ...prev.items.skills },
            policies: { ...prev.items.policies },
          };
          let persona = prev.persona;
          for (const field of fields) {
            delete switches[field];
            if (field === "persona") persona = undefined;
            for (const kind of ["tools", "skills", "policies"] as const) {
              const pair = LIST_FIELDS[kind];
              if (field === pair.allow || field === pair.deny) items[kind] = {};
            }
          }
          // 不展开 `prev`：它的 `persona` 正是要清掉的那一项，展开会把旧值又盖回来。
          return { switches, items, ...(persona === undefined ? {} : { persona }) };
        });
      })
      .catch((cause: unknown) => {
        setNotice(`${t("saveFailed")}: ${messageOf(cause)}`);
      });
  };

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
        setNotice(t(target === "session" ? "applied" : "saved"));
      })
      .catch((cause: unknown) => {
        // 写失败**不清草稿**：用户可以原样重试，改到一半的内容不该被一个网络错误吃掉。
        setNotice(`${t("saveFailed")}: ${messageOf(cause)}`);
      });
  };

  // 删掉会话上当前模式的自定义：服务端会把会话落回内置默认，所以删完再拉一次生效态。
  const removeCurrent = (): void => {
    if (sessionId === undefined) return;
    setConfirmingDelete(false);
    void store
      .remove(sessionId)
      .then(async (mode) => {
        setNotice(`${t("deleted")} ${mode}`);
        setActive(await store.loadActive(sessionId));
        setDraft(EMPTY_DRAFT);
      })
      .catch((cause: unknown) => {
        setNotice(`${t("deleteFailed")}: ${messageOf(cause)}`);
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

  // 一条目录项当下是「允许 / 禁止 / 默认」：名单里点名的那档优先，其次是草稿，最后是目录给的继承档。
  const configValue = (entry: SessionModeDirectoryEntry): "unset" | SessionModeTriState => {
    if (entry.group !== undefined && effective.denyTools.includes(groupRef(entry.group)))
      return "deny";
    return entry.fallback === undefined || entry.fallback === "default" ? "unset" : entry.fallback;
  };

  // 这一条在会话上被改过没有：目录给的 `override` 就是「生效值 ≠ 模式默认」的那一档。
  const entryOverridden = (entry: SessionModeDirectoryEntry): boolean =>
    entry.override !== undefined && entry.override !== null;

  // 「只看可调用」的判据只用目录里已有的信息推：模式默认档 + 本会话覆盖 + 本地草稿，都不含 deny。
  // （`active.catalog.tools` 本身就是本会话可见的工具集；再滤掉被 deny 的那些。）
  const callable = (entry: SessionModeDirectoryEntry): boolean => {
    const groupDraft =
      entry.group === undefined ? undefined : draft.items.tools[groupRef(entry.group)];
    if (groupDraft !== undefined) return groupDraft !== "deny";
    return (draft.items.tools[entry.id] ?? entry.override ?? configValue(entry)) !== "deny";
  };

  const otherGroupLabel = t("otherGroup");
  const toolGroups = new Map<string, SessionModeDirectoryEntry[]>();
  for (const entry of active.catalog.tools) {
    if (onlyCallable && !callable(entry)) continue;
    // 目录里没有组的条目（工具都有组，这里只是兜底）归到本包字典里的「其它」那一档。
    const group = entry.group ?? otherGroupLabel;
    const list = toolGroups.get(group);
    if (list === undefined) toolGroups.set(group, [entry]);
    else list.push(entry);
  }

  return (
    <div data-role="session-mode-panel" data-panel={panelId} style={PANEL_STYLE}>
      <Stack gap="wide">
        <Stack gap={4}>
          <Text size="lg">{active.mode.name}</Text>
          <Text size="sm" tone="tertiary">
            {active.mode.description.length === 0 ? t("noDescription") : active.mode.description}
          </Text>
        </Stack>

        {section(
          "general",
          t("general"),
          <Stack gap={6}>
            {(
              [
                ["instructions", "instructions", effective.instructions],
                ["skills", "skillsCatalog", effective.skills],
                ["runtimeContext", "runtimeContext", effective.runtimeContext],
              ] as const
            ).map(([key, labelKey, value]) => (
              <Row key={key} gap={6} align="center" justify="between">
                <Stack gap={2}>
                  <Text size="md">{t(labelKey)}</Text>
                  <SourceLine
                    source={source(key)}
                    restoreLabel={t("restoreDefault")}
                    onRestore={
                      overridden.has(key)
                        ? () => {
                            restore([key]);
                          }
                        : undefined
                    }
                  />
                </Stack>
                <Switch
                  checked={draft.switches[key] ?? value}
                  label={t(labelKey)}
                  onChange={(next) => {
                    setDraft((prev) => ({ ...prev, switches: { ...prev.switches, [key]: next } }));
                  }}
                />
              </Row>
            ))}
          </Stack>,
        )}

        {section(
          "persona",
          t("persona"),
          <Stack gap={6}>
            {(
              [
                ["prefix", "personaPrefix", "personaPrefixHint"],
                ["suffix", "personaSuffix", "personaSuffixHint"],
              ] as const
            ).map(([key, labelKey, hintKey]) => {
              // 草稿没动过这一项时，输入框显示的就是当下生效的那份（模式默认或会话覆盖）。
              const value = draft.persona?.[key] ?? effective.persona[key];
              return (
                <Stack key={key} gap={2}>
                  <Text size="md">{t(labelKey)}</Text>
                  <MultilineField
                    aria-label={t(labelKey)}
                    placeholder={t(hintKey)}
                    value={value}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setDraft((prev) => ({
                        ...prev,
                        persona: {
                          prefix: prev.persona?.prefix ?? effective.persona.prefix,
                          suffix: prev.persona?.suffix ?? effective.persona.suffix,
                          [key]: next,
                        },
                      }));
                    }}
                  />
                  <SourceLine
                    source={source("persona")}
                    restoreLabel={t("restoreDefault")}
                    onRestore={
                      overridden.has("persona")
                        ? () => {
                            restore(["persona"]);
                          }
                        : undefined
                    }
                  />
                </Stack>
              );
            })}
          </Stack>,
        )}

        {section(
          "tools",
          `${t("tools")} (${String(active.catalog.tools.length)})`,
          <Stack gap={2}>
            <Row gap={6} align="center" justify="between">
              <Stack gap={2}>
                <Text size="md">{t("onlyCallable")}</Text>
                <Text size="sm" tone="tertiary">
                  {t("onlyCallableHint")}
                </Text>
              </Stack>
              <Switch
                checked={onlyCallable}
                label={t("onlyCallable")}
                onChange={(next) => {
                  setOnlyCallable(next);
                }}
              />
            </Row>
            {toolGroups.size === 0 && onlyCallable ? (
              <Text size="sm" tone="tertiary">
                {t("empty")}
              </Text>
            ) : null}
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
              // 组这一层的来源：把每条的模式默认档（目录给的 `fallback`）与生效档比一遍，
              // 有一处不同就是这个会话盖过——不另加字段，也不用猜名单。
              const groupOverridden = entries.some((entry) => {
                const fallback =
                  entry.fallback === undefined || entry.fallback === "default"
                    ? "unset"
                    : entry.fallback;
                return (entry.override ?? configValue(entry)) !== fallback;
              });
              return (
                <Stack key={group} gap={2}>
                  <TriStateRow
                    id={`${entries[0]?.groupLabel ?? group} (${String(entries.length)})`}
                    value={groupValue}
                    onChange={(next) => {
                      setDraft((prev) => ({
                        ...prev,
                        items: {
                          ...prev.items,
                          tools: { ...prev.items.tools, [groupRef(group)]: next },
                        },
                      }));
                    }}
                    onLabelClick={() => {
                      setOpenGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group)) next.delete(group);
                        else next.add(group);
                        return next;
                      });
                    }}
                    t={t}
                    source={groupOverridden ? t("fromSession") : t("fromMode")}
                    restoreLabel={t("restoreDefault")}
                    onRestore={
                      groupOverridden
                        ? () => {
                            // 组引用只是名单里的一项：清覆盖 = 把这对名单回退给模式默认。
                            restore([LIST_FIELDS.tools.allow, LIST_FIELDS.tools.deny]);
                          }
                        : undefined
                    }
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
                          t={t}
                          source={
                            entryOverridden(entry) ? t("fromSession") : t("fromMode")
                          }
                          restoreLabel={t("restoreDefault")}
                          onRestore={
                            entryOverridden(entry)
                              ? () => {
                                  restore([LIST_FIELDS.tools.allow, LIST_FIELDS.tools.deny]);
                                }
                              : undefined
                          }
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
          `${t("skills")} (${String(active.catalog.skills.length)})`,
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
                t={t}
                source={entryOverridden(entry) ? t("fromSession") : t("fromMode")}
                restoreLabel={t("restoreDefault")}
                onRestore={
                  entryOverridden(entry)
                    ? () => {
                        restore([LIST_FIELDS.skills.allow, LIST_FIELDS.skills.deny]);
                      }
                    : undefined
                }
              />
            ))}
          </Stack>,
        )}

        {section(
          "policies",
          `${t("policies")} (${String(active.catalog.policies.length)})`,
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
                t={t}
                source={entryOverridden(entry) ? t("fromSession") : t("fromMode")}
                restoreLabel={t("restoreDefault")}
                onRestore={
                  entryOverridden(entry)
                    ? () => {
                        restore([LIST_FIELDS.policies.allow, LIST_FIELDS.policies.deny]);
                      }
                    : undefined
                }
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
            {t("reset")}
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
              {t("apply")}
            </Button>
            <Menu
              open={menuOpen}
              align="end"
              anchor={
                <Button
                  variant="primary"
                  aria-label={t("moreSaveWays")}
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
                {t("saveDefault")}
              </MenuItemButton>
              {/* 「另存为」要用户给新模式的 code / name（`store.saveAs` 的三个参数），那个输入面还没做。
                  禁用行必须给出**理由**（`disabledReason` 会读成该行的 description 并弹 tooltip），
                  否则用户只会当成 bug。 */}
              <MenuItemButton
                disabled
                disabledReason={t("saveAsNeedsName")}
                onSelect={() => {}}
              >
                {t("saveAs")}
              </MenuItemButton>
              <MenuItemButton
                disabled={!active.deletable}
                {...(active.deletable ? {} : { disabledReason: t("deleteBuiltinReason") })}
                danger
                onSelect={() => {
                  setMenuOpen(false);
                  setConfirmingDelete(true);
                }}
              >
                {t("delete")}
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
            title={t("deleteCurrentTitle")}
            closeLabel={t("cancel")}
            description={`「${active.mode.name}」${t("deleteConfirm")}`}
            footer={
              <Row gap={8} justify="end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirmingDelete(false);
                  }}
                >
                  {t("cancel")}
                </Button>
                <Button variant="primary" tone="danger" onClick={removeCurrent}>
                  {t("confirmDelete")}
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

// 一行「来源 + 恢复默认」：来源一直显示（每个可改字段都要能看出现在吃的是哪一份），
// 恢复默认只在**这个字段被会话覆盖过**时给——多点几次没有意义。
function SourceLine({
  source,
  restoreLabel,
  onRestore,
}: {
  readonly source: string;
  readonly restoreLabel?: string | undefined;
  readonly onRestore?: (() => void) | undefined;
}): ReactNode {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Text size="sm" tone="tertiary">
        {source}
      </Text>
      {onRestore === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            onRestore();
          }}
          style={{
            background: "none",
            border: 0,
            padding: 0,
            font: "inherit",
            fontSize: 12,
            color: "var(--dsw-alias-label-secondary)",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          {restoreLabel}
        </button>
      )}
    </span>
  );
}

function TriStateRow({
  id,
  description,
  value,
  indent = 0,
  onChange,
  onLabelClick,
  source,
  restoreLabel,
  onRestore,
  t,
}: {
  readonly id: string;
  readonly description?: string | undefined;
  readonly value: TriValue;
  readonly indent?: number | undefined;
  readonly onChange: (next: "unset" | SessionModeTriState) => void;
  readonly onLabelClick?: (() => void) | undefined;
  // 这一行的来源（会话覆盖 / 模式默认）；不给就不显示。
  readonly source?: string | undefined;
  readonly restoreLabel?: string | undefined;
  readonly onRestore?: (() => void) | undefined;
  // 三态那几档的文案（中英各一份在 `locales.ts`）：纯展示组件不装 Locale 服务，由调用方把 `t` 递进来。
  readonly t?: SessionModeTranslate | undefined;
}): ReactNode {
  const translate = t ?? fallbackTranslate;
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
        {source === undefined ? null : (
          <SourceLine source={source} restoreLabel={restoreLabel} onRestore={onRestore} />
        )}
      </span>
      <SegmentedControl<"unset" | "allow" | "deny" | "mixed">
        id={`tri-${id.replace(/[^a-zA-Z0-9_-]+/gu, "-")}`}
        label={id}
        value={value}
        options={
          value === "mixed"
            ? [
                { value: "mixed", label: translate("stateMixed") },
                { value: "unset", label: translate("stateDefault") },
                { value: "allow", label: translate("stateAllow") },
                { value: "deny", label: translate("stateDeny") },
              ]
            : [
                { value: "unset", label: translate("stateDefault") },
                { value: "allow", label: translate("stateAllow") },
                { value: "deny", label: translate("stateDeny") },
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
