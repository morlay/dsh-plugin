// 跨工作区复制（L2：真装配 + 真库）：本包 fork + workspace 的 attach 两件组合，本包不新增移动动作。
//
// 工作区记录不归本包：装配里给它一份满足 `WorkspaceRegistry` 的注册表（`@morlay/dsh-workspace/testing`）。
// 判据：子会话的 header cwd 是目标工作区的路径、attach 被调用一次且参数是子会话、源会话原样还在。
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionId } from "@morlay/dsh-session/contract";
import { meta, turnLog } from "@morlay/dsh-session/testing";
import { asRdbStore } from "@morlay/session-rdb";
import { SessionStoreError } from "@morlay/session-rdb";
import { WorkspaceRegistry } from "@morlay/dsh-workspace";
import { FakeWorkspaceRegistry, workspaceOf } from "@morlay/dsh-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";
import { copyAttachFailedError } from "../store.ts";
import { mount, publishToken, type MountedRow } from "../../__tests__/support/base.ts";

const mounted: MountedRow[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const row of mounted.splice(0)) await row.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

interface Fixture {
  readonly row: MountedRow;
  readonly workspaces: FakeWorkspaceRegistry;
  readonly targetId: string;
  readonly targetPath: string;
}

// 目标工作区目录要真实存在：workspace 的 attach 会 realpath + stat 它。
//
// `onAttach` 是 workspace 域留的钩子（`workspaceOf`）：要造「attach 被拒」的登记行就在这里抛。
async function start(options: { readonly onAttach?: () => void } = {}): Promise<Fixture> {
  const workspaces = new FakeWorkspaceRegistry();
  const targetPath = await realpath(await mkdtemp(join(tmpdir(), "copy-target-")));
  roots.push(targetPath);
  const target =
    options.onAttach === undefined
      ? await workspaces.create(targetPath)
      : workspaceOf(targetPath, options.onAttach);
  if (options.onAttach !== undefined) workspaces.rows.push(target);
  // 注册表在建行之前发布：本包注入 `WorkspaceRegistry` 令牌，注入在装配期回填。
  const row = await mount({
    before: (ctx) => {
      publishToken(ctx, WorkspaceRegistry, workspaces);
    },
  });
  mounted.push(row);
  return { row, workspaces, targetId: String(target.id), targetPath };
}

async function seedSession(fixture: Fixture, id: string): Promise<number> {
  const handle = await fixture.row.persistence.create(meta(id, "/work"));
  const log = turnLog(0, 1, { users: [{ id: id + "-u", text: "要复制的会话" }] });
  await handle.append(log);
  await handle.close();
  return log.length;
}

describe("L2 跨工作区复制", () => {
  it("复制到目标工作区：子会话的 cwd 是目标路径、attach 收到子会话，源会话原样留下", async () => {
    const fixture = await start();
    const store = asRdbStore(fixture.row.persistence);
    const length = await seedSession(fixture, "copy-source");

    const copied = await store.copyToWorkspace("copy-source", fixture.targetId);

    expect(copied.workspaceId).toBe(fixture.targetId);
    expect(copied.sessionId).not.toBe("copy-source");
    // 子会话的 header：父引用指向源会话，cwd 换成目标工作区的路径（attach 校验的就是这一条）。
    const reader = await fixture.row.persistence.open(SessionId(copied.sessionId), "read");
    expect(reader.header).toMatchObject({
      cwd: fixture.targetPath,
      parentSession: "copy-source",
    });
    const child = await reader.read();
    await reader.close();
    expect(child.events.map((event) => event.seq)).toEqual(
      Array.from({ length }, (_value, index) => index),
    );
    // 成员归属由 workspace 域做：attach 收到的是子会话。
    expect(fixture.workspaces.attached).toEqual([
      { workspaceId: "w-" + fixture.targetPath, sessionId: copied.sessionId },
    ]);
    // 复制不是移动：源会话还在列表里，日志没动。
    expect((await store.listRows({ limit: 10 })).items.map((row) => row.sessionId).sort()).toEqual(
      ["copy-source", copied.sessionId].sort(),
    );
    expect((await store.load("copy-source")).events).toHaveLength(length);
  });

  it("目标工作区不在注册表里：带 SESSION_COPY_WORKSPACE_NOT_FOUND，库里不多一条会话", async () => {
    const fixture = await start();
    const store = asRdbStore(fixture.row.persistence);
    await seedSession(fixture, "copy-source");

    await expect(store.copyToWorkspace("copy-source", "w-absent")).rejects.toMatchObject({
      code: "SESSION_COPY_WORKSPACE_NOT_FOUND",
    });

    // 先认工作区再 fork：拒绝时不留下谁也不认识的派生会话。
    expect((await store.listRows({ limit: 10 })).items.map((row) => row.sessionId)).toEqual([
      "copy-source",
    ]);
    expect(fixture.workspaces.attached).toEqual([]);
  });

  it("attach 被拒：带 SESSION_COPY_ATTACH_FAILED，补偿删除把派生会话收掉", async () => {
    const fixture = await start({
      onAttach: () => {
        throw new Error("workspace 拒绝了 attach");
      },
    });
    const store = asRdbStore(fixture.row.persistence);
    await seedSession(fixture, "copy-source");

    const failure = await store
      .copyToWorkspace("copy-source", fixture.targetId)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SessionStoreError);
    expect(failure).toMatchObject({ code: "SESSION_COPY_ATTACH_FAILED" });
    expect((failure as Error).message).toContain("workspace 拒绝了 attach");
    // 复制要么落在目标工作区、要么库里不多一条谁也找不到的会话：补偿删除已经把它收掉了。
    expect((await store.listRows({ limit: 10 })).items.map((row) => row.sessionId)).toEqual([
      "copy-source",
    ]);
  });

  it("装配里没有工作区注册表：装配错误按约定抛 `session-rdb: ` 前缀的裸 Error（不占 wire 域码）", async () => {
    // 装配期错误与运行期失败是两件事：清单里缺本包依赖的服务不是「域失败」，不占一个域码；
    // 约定（见 admin/store.ts 头部）是 `Error` + `session-rdb: ` 前缀，这里把它钉住。
    const row = await mount();
    mounted.push(row);
    const store = asRdbStore(row.persistence);
    const handle = await row.persistence.create(meta("no-registry", "/work"));
    await handle.close();

    await expect(store.copyToWorkspace("no-registry", "w-any")).rejects.toThrow(
      /^session-rdb: 装配里没有 WorkspaceRegistry/,
    );
  });

  it("补偿删除也失败时两个失败都在原因链里（AggregateError）", () => {
    const attach = new Error("workspace 拒绝了 attach");
    const undo = new Error("派生会话删不掉");

    const plain = copyAttachFailedError("w-x", attach);
    expect(plain.code).toBe("SESSION_COPY_ATTACH_FAILED");
    expect(plain.cause).toBe(attach);

    const both = copyAttachFailedError("w-x", attach, undo);
    expect(both.code).toBe("SESSION_COPY_ATTACH_FAILED");
    // 原始失败不能被「撤不干净」顶掉：两个都在，顺序是 [attach, 补偿删除]。
    expect(both.cause).toBeInstanceOf(AggregateError);
    expect((both.cause as AggregateError).errors).toEqual([attach, undo]);
    expect(both.message).toContain("workspace 拒绝了 attach");
    expect(both.message).toContain("派生会话删不掉");
  });
});
