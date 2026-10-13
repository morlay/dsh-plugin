import { describe, expect, it } from "vitest";
import { createStreamUplink } from "../stream-uplink.ts";

function harness(): { uplink: ReturnType<typeof createStreamUplink>; log: string[] } {
  const log: string[] = [];
  const uplink = createStreamUplink(
    (streamId, item) => {
      log.push(`send ${String(streamId)} ${JSON.stringify(item)}`);
    },
    (streamId) => {
      log.push(`end ${String(streamId)}`);
    },
  );
  return { uplink, log };
}

describe("页面侧流的上行通道", () => {
  it("id 未到时先排队，绑定后按序发出", () => {
    const { uplink, log } = harness();
    uplink.push({ typed: "a" });
    uplink.push({ typed: "b" });
    expect(log).toEqual([]);
    uplink.bind(7);
    expect(log).toEqual(['send 7 {"typed":"a"}', 'send 7 {"typed":"b"}']);
    uplink.push({ typed: "c" });
    expect(log.at(-1)).toBe('send 7 {"typed":"c"}');
    expect(log.some((line) => line.startsWith("end"))).toBe(false);
  });

  it("上行结束时先交完排队项再收尾", () => {
    const { uplink, log } = harness();
    uplink.push({ typed: "a" });
    uplink.close();
    uplink.push({ typed: "late" });
    uplink.bind(3);
    expect(log).toEqual(['send 3 {"typed":"a"}', "end 3"]);
  });

  it("绑定后结束直接收尾，重复绑定报错", () => {
    const { uplink, log } = harness();
    uplink.bind(5);
    uplink.close();
    uplink.close();
    expect(log).toEqual(["end 5"]);
    expect(() => {
      uplink.bind(6);
    }).toThrow(/already bound/u);
  });
});
