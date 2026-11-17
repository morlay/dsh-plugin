import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INSPECTOR_PORT,
  devtoolsAddressOf,
  nodeInspectorOf,
  type InspectorPort,
} from "../inspector.ts";

const opened: InspectorPort[] = [];

afterEach(async () => {
  for (const inspector of opened.splice(0)) await inspector.close();
});

/**
 * @returns 此刻空闲的一个端口（先问内核要，再让出来）。
 */
async function freePortOf(): Promise<number> {
  const server = await listen(0);
  const port = portOf(server);
  await close(server);
  return port;
}

/**
 * @param port - 端口（0 = 让内核挑）。
 * @returns 已在 `127.0.0.1` 上监听的服务器。
 */
function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/**
 * @param server - 服务器。
 * @returns 它实际占的端口。
 */
function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("没有监听地址");
  return address.port;
}

/**
 * @param server - 服务器。
 * @returns 关掉。
 */
function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
  });
}

/**
 * @param port - 端口。
 * @returns 这个端口的 `/json/list` 能不能取到（能取到说明 inspector 在这上面）。
 */
function reachable(port: number): Promise<boolean> {
  return fetch(`http://127.0.0.1:${port}/json/list`).then(
    (response) => response.ok,
    () => false,
  );
}

describe("主进程 Inspector（接缝 + `node:inspector` 适配器）", () => {
  it("地址是能粘进 Chrome DevTools 的那一条", () => {
    expect(devtoolsAddressOf("ws://127.0.0.1:9229/54ae6e25-5509-4bd9-ac69-bd78d0cadac7")).toBe(
      "devtools://devtools/bundled/inspector.html?ws=127.0.0.1:9229/54ae6e25-5509-4bd9-ac69-bd78d0cadac7",
    );
    expect(DEFAULT_INSPECTOR_PORT).toBe(9229);
  });

  it("真适配器起得来：只绑 127.0.0.1，端口的 /json/list 拿得到", async () => {
    const inspector = nodeInspectorOf();
    opened.push(inspector);
    const start = await freePortOf();
    const session = await inspector.open({ port: start });
    expect(inspector.opened).toBe(true);
    expect(session.port).toBe(start);
    expect(session.host).toBe("127.0.0.1");
    // 地址必须带**真实**端口与那一次的 uuid（粘进 Chrome DevTools 才连得上）。
    expect(
      session.address.startsWith(
        `devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${String(start)}/`,
      ),
    ).toBe(true);
    expect(await reachable(session.port)).toBe(true);
  });

  it("起始端口被占就顺延（端口冲突不该是错误）", async () => {
    const busy = await listen(0);
    const start = portOf(busy);
    const inspector = nodeInspectorOf();
    opened.push(inspector);
    try {
      const session = await inspector.open({ port: start, attempts: 3 });
      expect(session.port).not.toBe(start);
      expect(session.port).toBeGreaterThan(start);
      expect(await reachable(session.port)).toBe(true);
    } finally {
      await close(busy);
    }
  });

  it("关掉就释放端口；再关一次不报错", async () => {
    const inspector = nodeInspectorOf();
    opened.push(inspector);
    const session = await inspector.open({ port: await freePortOf() });
    await inspector.close();
    expect(inspector.opened).toBe(false);
    expect(await reachable(session.port)).toBe(false);
    await inspector.close();
    expect(inspector.opened).toBe(false);
  });

  it("连着开两次是同一个端口（不重复开）", async () => {
    const inspector = nodeInspectorOf();
    opened.push(inspector);
    const first = await inspector.open({ port: await freePortOf() });
    const second = await inspector.open({ port: await freePortOf() });
    expect(second.port).toBe(first.port);
    expect(second.address).toBe(first.address);
  });
});
