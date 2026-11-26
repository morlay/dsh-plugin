// `credentials` 组的宿主实现：转发到上游 `CredentialProvider`（`CredentialsDefault` 已装）。
//
// 与上游 `CredentialsController` 的三条 wire 义务对齐：批量读的**字段投影**（只带 `CredentialInfo`
// 声明的字段）、引用名语法、以及「没有任何读取路径回传密钥值」。
import { credentialRef } from "../index.ts";
import type { CredentialInfo } from "@deepseek-ai/dsh-credentials";
import { Credentials } from "@morlay/zephyr-app";
import { inject, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { CredentialsEndpoint } from "../endpoint/credentials-endpoint.ts";

/** 一次 `describe` 的扇出上限（上游同值：`credentials.ts:36`）。 */
const MAX_DESCRIBE_REFS = 64;

/** 引用名语法（上游 `credentialRefSchema`）。 */
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 只拷贝 `CredentialInfo` 声明的字段：provider 若多带了可枚举属性，不会随 wire 漏出去。
 * @param info - provider 对一个引用的回答。
 * @returns 同样的字段，不带多余属性。
 */
function projectCredentialInfo(info: CredentialInfo): CredentialInfo {
  return {
    configured: info.configured,
    ...(info.source === undefined ? {} : { source: info.source }),
    writable: info.writable,
  };
}

/**
 * 校验引用名（语法 + 数量）。
 * @param refs - wire 上的引用名列表。
 * @returns 原列表。
 */
function checkedRefs(refs: readonly string[]): readonly string[] {
  if (!Array.isArray(refs) || refs.length > MAX_DESCRIBE_REFS) {
    throw new Error(`credentials/describe: refs 必须是至多 ${MAX_DESCRIBE_REFS} 项的数组`);
  }
  for (const ref of refs) {
    if (typeof ref !== "string" || !CREDENTIAL_REF.test(ref)) {
      throw new Error(`credentials/describe: 引用名 "${String(ref)}" 不合法`);
    }
  }
  return refs;
}

/** `credentials` 组的宿主实现。 */
@RemoteGroup({ name: "credentials" })
export class CredentialsEndpointDefault extends CredentialsEndpoint implements OnInit, OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  private readonly credentials = inject(Credentials);

  private stop = (): void => {};

  onInit(): void {
    this.stop = registerRemoteGroup(this.handlers, this);
  }

  onDispose(): void {
    this.stop();
  }

  override async describe(refs: string[]): Promise<Record<string, CredentialInfo>> {
    const checked = checkedRefs(refs);
    const entries = await Promise.all(
      checked.map(
        async (ref) =>
          [
            ref,
            projectCredentialInfo(await this.credentials.describe(credentialRef(ref))),
          ] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  override async set(ref: string, value: string): Promise<void> {
    await this.credentials.set(credentialRef(ref), value);
  }

  override async unset(ref: string): Promise<void> {
    await this.credentials.unset(credentialRef(ref));
  }
}
