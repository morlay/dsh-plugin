// 模式清单：装配事实（这条行的 config），页面生命周期里不会变，所以模块级只拉一次。
// 失败不缓存——下次挂载就是一次重试。
import { useEffect, useState } from "react";
import type { SessionModeRoster } from "../endpoint/session-mode-shapes.ts";
import type { SessionModeStore } from "./session-mode.store.ts";

export function useRoster(store: SessionModeStore): SessionModeRoster | undefined {
  const [roster, setRoster] = useState<SessionModeRoster | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    store.loadRoster().then(
      (value) => {
        if (alive) setRoster(value);
      },
      () => {
        // 读不到清单时 chip 不渲染（下一次挂载重试）。
      },
    );
    return () => {
      alive = false;
    };
  }, [store]);
  return roster;
}
