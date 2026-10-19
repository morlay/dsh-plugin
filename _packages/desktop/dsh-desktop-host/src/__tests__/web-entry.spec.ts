import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_PORT, webArgs } from "../web.ts";

describe("web 端口契约", () => {
  it("内层没给 --port 时补上 PORT（缺省 0）", () => {
    expect(webArgs([], DEFAULT_WEB_PORT)).toEqual(["--port", "0"]);
    expect(webArgs(["--no-open"], "4000")).toEqual(["--port", "4000", "--no-open"]);
  });

  it("内层显式给了 --port 就以它为准", () => {
    expect(webArgs(["--port", "8080"], "4000")).toEqual(["--port", "8080"]);
  });
});
