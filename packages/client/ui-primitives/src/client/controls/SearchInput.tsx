// 搜索输入：官方 `Input` + 宽度档（列表与设置面的搜索框是固定一档宽）。

import type { ComponentProps, ReactNode } from "react";
import { Input } from "@deepseek-ai/dsh-client-ui-primitives";
import { classes } from "./classes.ts";
import css from "./SearchInput.module.css";

export type SearchInputWidth = "search" | "full";

export type SearchInputProps = ComponentProps<typeof Input> & {
  // 宽度档：`search`（360px，列表的搜索行）或 `full`（撑满）。
  width?: SearchInputWidth;
};

export function SearchInput({ width = "search", className, ...rest }: SearchInputProps): ReactNode {
  return (
    <Input
      className={classes(className, width === "search" ? css.search : css.full)}
      {...rest}
    />
  );
}
