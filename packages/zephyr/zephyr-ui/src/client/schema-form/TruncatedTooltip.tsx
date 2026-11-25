// 行内文本的全文浮层：**只有确实被截断**时才给官方 `Tooltip`，放得下就一个浮层也不挂。
//
// 判据是元素自己的几何——`scrollWidth > clientWidth` 就是「这一格正被 `ellipsis` 截断」，不用字符数之类的估计。
// 几何会变的两个来源各一个观察器：宽度变化（窗口、面板、字段槽）归 `ResizeObserver`；盒子没变、只是换了
// 内容（值改了、注释换了）归 `MutationObserver`——后者是原来「每次提交重量一次」覆盖的那种情形，
// 现在按通知重测，而不是每个提交无条件测一遍。

import {
  cloneElement,
  useCallback,
  useLayoutEffect,
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
  // 被测的元素本身放进 state（不放进 ref）：回调 ref 只**交出**元素，读几何的都在观察器回调里，
  // 渲染期因此不碰任何 ref / DOM（`react/refs`）。
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [truncated, setTruncated] = useState(false);

  const measure = useCallback(() => {
    if (element === null) return;
    setTruncated(element.scrollWidth > element.clientWidth);
  }, [element]);

  // ref 一直挂在子元素上（没截断时也挂着）：身份稳定（不随渲染重建），挂上就把元素交出去，
  // 元素换了 / 卸载了由下面的 effect 重挂、退订。
  const anchor = useCallback((el: HTMLElement | null) => {
    setElement(el);
  }, []);

  // 两个观察器都盯着这个元素，通知到了才测（不在 effect 里同步写状态）。
  // `ResizeObserver` 在 observe 后会先给一次初始读数，所以挂上就有第一次判据。
  useLayoutEffect(() => {
    if (element === null) return;
    const resize = new ResizeObserver(measure);
    const mutation = new MutationObserver(measure);
    resize.observe(element);
    mutation.observe(element, { characterData: true, childList: true, subtree: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [element, measure]);

  // 没截断时走 `Tooltip` 自己的 `disabled`：气泡不渲染、hover 也不弹，锚元素同时不重挂
  //（换成「有截断才包 `Tooltip`」会在截断状态翻转时把锚换掉，白丢一次 DOM）。
  return (
    <Tooltip label={label} side="bottom" portal disabled={!truncated}>
      {cloneElement(children, { ref: anchor })}
    </Tooltip>
  );
}
