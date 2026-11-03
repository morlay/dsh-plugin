import { describe, expect, it } from "vitest";
import { column, E, operandSql, render } from "../index.ts";

/** 表达式 → 某方言的 SQL 文本（不需要连库）。 */
function sqlOf(expression: import("../index.ts").Operand, dialect: "sqlite" | "postgres"): string {
  return render(operandSql(expression), dialect).text;
}

describe("业务表达式（方言相关的由 rdbkit 渲染）", () => {
  it("add：列自增与 upsert 里的 excluded 累加", () => {
    expect(sqlOf(E.add(column("f_revision"), 1), "sqlite")).toBe('"f_revision" + ?');
    expect(sqlOf(E.add(column("f_count"), E.excluded("f_count")), "postgres")).toBe(
      '"f_count" + excluded."f_count"',
    );
  });

  it("toInt / countIf：布尔条件当整数列与条件计数", () => {
    expect(sqlOf(E.toInt(E.eq(column("f_origin", "t_sessions"), "subagent")), "sqlite")).toBe(
      "CASE WHEN \"t_sessions\".\"f_origin\" = ? THEN 1 ELSE 0 END",
    );
    expect(sqlOf(E.countIf(E.eq(column("f_type"), "turn/start")), "postgres")).toBe(
      'SUM(CASE WHEN "f_type" = $1 THEN 1 ELSE 0 END)',
    );
  });

  it("maxOf：只增不减（两方言同一份 CASE 表达式）", () => {
    expect(sqlOf(E.maxOf(column("f_last_event_at"), 42), "sqlite")).toBe(
      'CASE WHEN COALESCE("f_last_event_at", 0) < ? THEN ? ELSE COALESCE("f_last_event_at", 0) END',
    );
  });

  it("localDay：按本地时区把毫秒时间戳渲染成 YYYY-MM-DD", () => {
    expect(sqlOf(E.localDay(column("f_created_at")), "sqlite")).toBe(
      "date(\"f_created_at\" / 1000, 'unixepoch', 'localtime')",
    );
    expect(sqlOf(E.localDay(column("f_created_at")), "postgres")).toBe(
      "to_char(to_timestamp(\"f_created_at\" / 1000.0), 'YYYY-MM-DD')",
    );
  });

  it("jsonText / jsonInt：JSON 提取按方言渲染，路径不拼进 SQL 文本", () => {
    expect(sqlOf(E.jsonText(column("f_data"), "$.data.message.source.provider"), "sqlite")).toBe(
      'json_extract("f_data", ?)',
    );
    expect(sqlOf(E.jsonText(column("f_data"), "$.data.message.source.provider"), "postgres")).toBe(
      `"f_data"::json #>> '{data,message,source,provider}'`,
    );
    expect(sqlOf(E.jsonInt(column("f_data"), "$.data.usage.inputTokens"), "sqlite")).toBe(
      'json_extract("f_data", ?)',
    );
    expect(sqlOf(E.jsonInt(column("f_data"), "$.data.usage.inputTokens"), "postgres")).toBe(
      `("f_data"::json #>> '{data,usage,inputTokens}')::integer`,
    );
  });

  it("方言分支只保留本方言的占位符（不产生多余绑定参数）", () => {
    const expression = E.localDay(column("f_created_at"));
    expect(render(operandSql(expression), "sqlite").params).toEqual([]);
    expect(render(operandSql(expression), "postgres").params).toEqual([]);
    const withParam = E.add(column("f_count"), 7);
    expect(render(operandSql(withParam), "sqlite").params).toEqual([7]);
    expect(render(operandSql(withParam), "postgres").params).toEqual([7]);
  });
});
