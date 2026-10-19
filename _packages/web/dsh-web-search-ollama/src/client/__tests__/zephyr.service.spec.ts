// 配置页上这一行看到的东西：每个字段的中/英标签与说明。

import { describe, expect, it } from "vitest";
import { en, zh } from "../locales.ts";
import { fieldWordingOf, NS, WEB_SEARCH_NS } from "../zephyr.service.ts";

interface Described {
  ns: string;
  path: readonly string[];
  read: () => { label?: string | undefined; hint?: string | undefined };
}

const FIELDS = ["apiKey", "apiKeyEnv", "baseURL", "maxResults"] as const;

function wordingOf(language: "zh" | "en"): Described[] {
  const dictionary = language === "en" ? en : zh;
  const described: Described[] = [];
  const locale = {
    bind: (ns: string) => (key: string) => (ns === NS ? dictionary[key as keyof typeof zh] : key),
    register: () => () => {},
  };
  const hints = {
    describe: (
      ns: string,
      path: readonly string[],
      read: () => { label?: string; hint?: string },
    ) => {
      described.push({ ns, path, read });
      return () => {};
    },
  };

  fieldWordingOf(locale, hints);
  return described;
}

describe("联网搜索的配置页字段", () => {
  it("四个字段都显示在本行的配置页上", () => {
    expect(wordingOf("zh").map((entry) => [entry.ns, entry.path.join(".")])).toEqual(
      FIELDS.map((field) => [WEB_SEARCH_NS, field]),
    );
  });

  it("中文界面显示中文标签与说明", () => {
    expect(wordingOf("zh").map((entry) => entry.read())).toEqual([
      { label: zh.apiKey, hint: zh.apiKeyHint },
      { label: zh.apiKeyEnv, hint: zh.apiKeyEnvHint },
      { label: zh.baseURL, hint: zh.baseURLHint },
      { label: zh.maxResults, hint: zh.maxResultsHint },
    ]);
  });

  it("英文界面显示英文标签与说明", () => {
    expect(wordingOf("en").map((entry) => entry.read())).toEqual([
      { label: en.apiKey, hint: en.apiKeyHint },
      { label: en.apiKeyEnv, hint: en.apiKeyEnvHint },
      { label: en.baseURL, hint: en.baseURLHint },
      { label: en.maxResults, hint: en.maxResultsHint },
    ]);
  });
});
