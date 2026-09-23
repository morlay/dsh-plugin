import { useEffect, useState } from "react";
import type { SessionModeRoster } from "../shared.ts";
import { fetchRoster } from "./api.ts";

/**
 * 模块级缓存：清单是装配事实（`session-mode` 行的 config），页面生命周期里不会变，两次挂载之间不必重拉。
 * 失败不缓存——下次挂载就是一次重试。
 */
let pending: Promise<SessionModeRoster> | undefined;

/** 读模式清单；还没读到（或读失败）时返回 undefined，组件据此不渲染。 */
export function useRoster(): SessionModeRoster | undefined {
  const [roster, setRoster] = useState<SessionModeRoster | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    pending ??= fetchRoster();
    pending.then(
      (value) => {
        if (alive) setRoster(value);
      },
      () => {
        pending = undefined;
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return roster;
}
