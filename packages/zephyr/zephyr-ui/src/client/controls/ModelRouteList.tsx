// 模型路由清单（`ModelRouteList`）：把"已设置的模型"按 provider 分组铺开，**只选一条**——一条路由就是
// provider + model 这一对，所以选它等于把两者一起定下来。
//
// 形态照官方"子智能体"那张卡的模型清单（分组标题 + 两行的项：模型名 / `provider · provider/model`），
// 区别只在这里是单选。

import type { ReactNode } from "react";
import { IconCheckOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { classes } from "./classes.ts";
import css from "./ModelRouteList.module.css";

// 一条可选路由：`key` 是稳定身份（调用方只用来比对，不解析它）。
export interface ModelRouteCandidate {
  readonly key: string;
  readonly provider: string;
  readonly providerName: string;
  readonly model: string;
  readonly modelName: string;
}

export interface ModelRouteListProps {
  // 清单的无障碍名（`role="radiogroup"`）。
  label: string;
  candidates: readonly ModelRouteCandidate[];
  // 当前选中的那条（没选 = `undefined`）。
  selectedKey: string | undefined;
  disabled?: boolean;
  // 读目录的状态：读的时候说一句、失败的时候说另一句。
  status: "loading" | "ready" | "error";
  loadingLabel: string;
  errorLabel: string;
  emptyLabel: string;
  onSelect: (candidate: ModelRouteCandidate) => void;
}

export function ModelRouteList({
  label,
  candidates,
  selectedKey,
  disabled = false,
  status,
  loadingLabel,
  errorLabel,
  emptyLabel,
  onSelect,
}: ModelRouteListProps): ReactNode {
  if (status === "loading") {
    return (
      <p className={css.notice} role="status">
        {loadingLabel}
      </p>
    );
  }
  if (status === "error") {
    return (
      <p className={css.error} role="alert">
        {errorLabel}
      </p>
    );
  }
  if (candidates.length === 0) {
    return <p className={css.notice}>{emptyLabel}</p>;
  }
  // 按 provider 分组，组的顺序就是候选来的顺序。
  const groups = new Map<string, { name: string; items: ModelRouteCandidate[] }>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.provider);
    if (group === undefined) {
      groups.set(candidate.provider, { name: candidate.providerName, items: [candidate] });
    } else group.items.push(candidate);
  }
  return (
    <div
      className={css.list}
      data-role="model-route-list"
      role="radiogroup"
      aria-label={label}
      data-control="model-routes"
    >
      {[...groups].map(([provider, group]) => (
        <div key={provider} className={css.group} data-route-group={provider}>
          <span className={css.provider}>{group.name}</span>
          {group.items.map((candidate) => {
            const picked = candidate.key === selectedKey;
            return (
              <div
                key={candidate.key}
                className={classes(css.item, picked ? css.picked : undefined)}
                role="radio"
                aria-checked={picked}
                aria-label={`${candidate.modelName} ${candidate.provider}/${candidate.model}`}
                aria-disabled={disabled ? true : undefined}
                tabIndex={disabled ? -1 : 0}
                data-route={candidate.key}
                onClick={() => {
                  if (!disabled) onSelect(candidate);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  if (!disabled) onSelect(candidate);
                }}
              >
                {picked ? <IconCheckOutlineRegular /> : <span aria-hidden="true" />}
                <span className={css.text}>
                  <span className={css.name}>{candidate.modelName}</span>
                  <span className={css.id}>
                    {`${candidate.providerName} · ${candidate.provider}/${candidate.model}`}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
