/**
 * `SettingsEndpoint` 的方法名与**上游 descriptor** 的一致性（防复发）。
 *
 * 这条判据曾经守的是一份手抄的方法名常量，而它抄错过：写成了 `describe / set / unset`——那三个里
 * `set` / `unset` 属于 **`credentials` 组**（同一个生成文件里两组都带 `describe`，读错 namespace 就会串）。
 * 现在方法名的 home 只有契约类上的 `@RemoteMethod()` 实参，判据因此是「契约类派生出的方法集 ==
 * 上游 `namespace === "settings"` 的 descriptor 方法集」，两头都不写死字符串。
 */
import { remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { SettingsEndpoint } from "../endpoint/settings.group.ts";
import { SETTINGS_REMOTE } from "../endpoint/index.ts";

/** descriptor 里本 spec 只读的两个字段（宽化成 string，避免与上游的字面量联合打架）。 */
interface DescriptorFields {
  readonly namespace?: string;
  readonly method?: string;
}

/** 从上游 descriptor 解析出 `settings` 组的方法名（排序后便于比较）。 */
function settingsMethodsOf(contribution: {
  readonly descriptors: readonly DescriptorFields[];
}): string[] {
  return contribution.descriptors
    .filter((d) => d.namespace === "settings")
    .map((d) => d.method)
    .filter((m): m is string => typeof m === "string")
    .sort();
}

/** 契约类派生出的方法名（`@RemoteMethod()` 的实参即 wire 名）。 */
function settingsEndpointMethods(): string[] {
  return remoteDescriptorsOf(SettingsEndpoint)
    .descriptors.map((descriptor) => descriptor.method)
    .filter((method): method is string => typeof method === "string")
    .sort();
}

describe("settings 组的方法名", () => {
  test("契约类的方法集等于上游 descriptor 的 `settings` 方法集", () => {
    const upstream = settingsMethodsOf(SETTINGS_REMOTE);
    // 先钉住"解析确实拿到了这 5 个"（解析失手会得到空数组，那样下面的对齐会假绿）。
    expect(upstream).toEqual(["describe", "mutate", "openSettingsDocument", "replace", "update"]);
    expect(settingsEndpointMethods()).toEqual(upstream);
  });

  test("不含 `set` / `unset`：它们是 `credentials` 组的方法", () => {
    const methods = settingsEndpointMethods();
    expect(methods).not.toContain("set");
    expect(methods).not.toContain("unset");
    // 反向核对：这两个名字确实在 descriptor 的**别的** namespace 里。
    const otherNamespaces: readonly (string | undefined)[] = SETTINGS_REMOTE.descriptors
      .filter((descriptor) => descriptor.namespace !== "settings")
      .map((descriptor) => descriptor.method);
    expect(otherNamespaces).toContain("set");
    expect(otherNamespaces).toContain("unset");
  });
});
