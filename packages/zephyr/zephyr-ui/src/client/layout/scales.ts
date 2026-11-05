// 布局原语的档位：几何只有这一套，四个原语与消费方都从这里取，页面不写数值。

// 间距档（px）：2/4/6/8 是行内与字段内的尺度，12/14/16 是区块之间的尺度。
export type LayoutGap = 0 | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | "wide";

// 交叉轴对齐：`stretch`（缺省）让列里子项撑满、行里子项等高。
export type LayoutAlign = "stretch" | "start" | "center" | "end";

// 主轴分布：`between` 用于"左列文本 + 右侧控件"那一行，`end` 用于贴右（分页）。
export type LayoutJustify = "start" | "center" | "between" | "end";

// 内距档：`card` = 模式卡片那档，`body` = 卡片内容那档，`page` / `row` / `blocking` 见样式表。
export type LayoutPad = "none" | "card" | "body" | "page" | "row" | "blocking";

// 文本字号档：11 / 12 / 13 / 16px。
export type TextSize = "xs" | "sm" | "md" | "base" | "lg";

// 文本颜色档。
export type TextTone = "primary" | "secondary" | "tertiary" | "danger";

// 文本字重档。
export type TextWeight = "medium" | "strong";

// 档位 → 类名。CSS Modules 的映射查表可能给 undefined（exactOptionalPropertyTypes），交给 `classes` 过滤。
export function gapClass(
  css: Readonly<Record<string, string | undefined>>,
  gap?: LayoutGap,
): string | undefined {
  if (gap === undefined) return undefined;
  // `wide` 是两轴不同间距的那一档（见样式表的 `.gapWide`）。
  return gap === "wide" ? css.gapWide : css[`gap${gap}`];
}

export function alignClass(
  css: Readonly<Record<string, string | undefined>>,
  align?: LayoutAlign,
): string | undefined {
  if (align === undefined || align === "stretch") return undefined;
  if (align === "start") return css.alignStart;
  return align === "center" ? css.alignCenter : css.alignEnd;
}

export function justifyClass(
  css: Readonly<Record<string, string | undefined>>,
  justify?: LayoutJustify,
): string | undefined {
  if (justify === undefined) return undefined;
  if (justify === "between") return css.justifyBetween;
  if (justify === "end") return css.justifyEnd;
  return justify === "center" ? css.justifyCenter : undefined;
}

export function padClass(
  css: Readonly<Record<string, string | undefined>>,
  pad?: LayoutPad,
): string | undefined {
  if (pad === undefined || pad === "none") return undefined;
  if (pad === "card") return css.padCard;
  if (pad === "body") return css.padBody;
  if (pad === "page") return css.padPage;
  return pad === "row" ? css.padRow : css.padBlocking;
}

export function sizeClass(
  css: Readonly<Record<string, string | undefined>>,
  size?: TextSize,
): string | undefined {
  if (size === undefined) return undefined;
  if (size === "xs") return css.sizeXs;
  if (size === "sm") return css.sizeSm;
  if (size === "md") return css.sizeMd;
  return size === "base" ? css.sizeBase : css.sizeLg;
}

export function toneClass(
  css: Readonly<Record<string, string | undefined>>,
  tone?: TextTone,
): string | undefined {
  if (tone === undefined) return undefined;
  if (tone === "primary") return css.tonePrimary;
  if (tone === "secondary") return css.toneSecondary;
  return tone === "tertiary" ? css.toneTertiary : css.toneDanger;
}

export function weightClass(
  css: Readonly<Record<string, string | undefined>>,
  weight?: TextWeight,
): string | undefined {
  if (weight === undefined) return undefined;
  return weight === "medium" ? css.weightMedium : css.strong;
}
