// 行内文本的全文浮层：**只有确实被截断**时才给官方 `Tooltip`，放得下就一个浮层也不挂。
//
// 判据是元素自己的几何——`scrollWidth > clientWidth` 就是「这一格正被 `ellipsis` 截断」，不用字符数之类的估计。
// 宽度变化（窗口、面板、字段槽）由 `ResizeObserver` 盯着这个元素重测；盒子没变、只是换了内容（值改了、注释换
// 了）不会被它通知，所以每次提交再重量一次。

import {
  cloneElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";

export function TruncatedTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ ref?: Ref<HTMLElement> }>;
}): ReactNode {
  const node = useRef<HTMLElement | null>(null);
  const watch = useRef<ResizeObserver | null>(null);
  const [truncated, setTruncated] = useState(false);

  const measure = useCallback(() => {
    const el = node.current;
    if (el === null) return;
    setTruncated(el.scrollWidth > el.clientWidth);
  }, []);

  // ref 一直挂在子元素上（没截断时也挂着）：挂上就盯着它的宽度，卸载时退订。
  const anchor = useCallback(
    (el: HTMLElement | null) => {
      watch.current?.disconnect();
      watch.current = null;
      node.current = el;
      if (el === null) return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      watch.current = observer;
    },
    [measure],
  );

  // 每次提交都重量一次：`ResizeObserver` 只对盒子尺寸发通知，换了文本的同尺寸盒子要靠这里。
  useLayoutEffect(measure);

  // 没截断时走 `Tooltip` 自己的 `disabled`：气泡不渲染、hover 也不弹，锚元素同时不重挂
  //（换成「有截断才包 `Tooltip`」会在截断状态翻转时把锚换掉，白丢一次 DOM）。
  return (
    <Tooltip label={label} side="bottom" portal disabled={!truncated}>
      {cloneElement(children, { ref: anchor })}
    </Tooltip>
  );
}
