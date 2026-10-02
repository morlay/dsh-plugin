// @vitest-environment jsdom
// 设置面通用控件：标签输入（multi-input：回车 / 粘贴 / 移除 / 候选菜单）、可搜索选择器（searchable：搜索过滤 /
// 选择 / 空态）、图标按钮、按钮文字不换行。
//
// 盯的接缝是**控件的输入输出**：粘贴与回车都折成"整段替换"的一次回调，候选菜单只列还没加进去的那些；
// 图标按钮没有文字，名字走无障碍名。样式几何归各控件自己的样式对象，这里只钉住它的关键数值。

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../client/controls/Button.tsx";
import { styles } from "../client/controls/controls.styles.ts";
import { IconButton } from "../client/controls/IconButton.tsx";
import { ModelRouteList } from "../client/controls/ModelRouteList.tsx";
import { SearchSelect } from "../client/controls/SearchSelect.tsx";
import { TagInput } from "../client/controls/TagInput.tsx";
import { mergeTags, parseTagList } from "../client/controls/tags.ts";

afterEach(cleanup);

describe("名单的文本解析", () => {
  it("粘贴的一串按逗号（中英）/ 分号 / 换行拆开：去空白、去重、保序", () => {
    expect(parseTagList("read, write；bash\nls")).toEqual(["read", "write", "bash", "ls"]);
    expect(parseTagList(" read ,,read ; read ")).toEqual(["read"]);
    expect(parseTagList("   ")).toEqual([]);
  });

  it("并进现有名单：重复的不再进来，现有的保持在前", () => {
    expect(mergeTags(["read"], ["write", "read"])).toEqual(["read", "write"]);
    expect(mergeTags([], ["bash"])).toEqual(["bash"]);
  });
});

describe("标签输入", () => {
  it("回车确认一个：整段替换的回调带上去重后的名单", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        value={["read"]}
        onChange={onChange}
        placeholder="加一个后回车"
        label="允许的工具"
        removeLabel={(name) => `移除 ${name}`}
      />,
    );

    const input = screen.getByLabelText("允许的工具");
    fireEvent.change(input, { target: { value: "read, bash" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["read", "bash"]);
  });

  it("粘贴一串拆成多个：中英逗号、分号、换行都是分隔符", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        value={[]}
        onChange={onChange}
        placeholder="加一个后回车"
        label="允许的工具"
        removeLabel={(name) => `移除 ${name}`}
      />,
    );

    fireEvent.paste(screen.getByLabelText("允许的工具"), {
      clipboardData: { getData: () => "write, bash；read\nls" },
    });

    expect(onChange).toHaveBeenCalledWith(["write", "bash", "read", "ls"]);
  });

  it("单个名字的粘贴不拦：照旧落进输入框，还能接着改", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        value={[]}
        onChange={onChange}
        placeholder="加一个后回车"
        label="允许的工具"
        removeLabel={(name) => `移除 ${name}`}
      />,
    );

    fireEvent.paste(screen.getByLabelText("允许的工具"), {
      clipboardData: { getData: () => "read" },
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("移除一个标签：回调给它去掉之后的那份", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        value={["read", "bash"]}
        onChange={onChange}
        placeholder="加一个后回车"
        label="允许的工具"
        removeLabel={(name) => `移除 ${name}`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "移除 read" }));

    expect(onChange).toHaveBeenCalledWith(["bash"]);
  });

  it("候选菜单只列还没加进去的那些：全加过就不给菜单", () => {
    const options = [
      { value: "read" },
      { value: "bash" },
      { value: "web_search" },
    ];
    const { rerender } = render(
      <TagInput
        value={["read"]}
        onChange={() => {}}
        options={options}
        placeholder="加一个后回车"
        label="允许的工具"
        candidatesLabel="从候选里选"
        removeLabel={(name) => `移除 ${name}`}
      />,
    );
    expect(screen.getByRole("button", { name: "从候选里选" })).toBeTruthy();

    rerender(
      <TagInput
        value={["read", "bash", "web_search"]}
        onChange={() => {}}
        options={options}
        placeholder="加一个后回车"
        label="允许的工具"
        candidatesLabel="从候选里选"
        removeLabel={(name) => `移除 ${name}`}
      />,
    );
    expect(screen.queryByRole("button", { name: "从候选里选" })).toBeNull();
  });
});

describe("图标按钮", () => {
  it("没有文字，名字走无障碍名；几何是侧边栏那种方形按钮", () => {
    render(
      <IconButton label="删除模式 编码模式">
        <span data-testid="glyph" />
      </IconButton>,
    );

    const button = screen.getByRole("button", { name: "删除模式 编码模式" });
    expect(button.textContent).toBe("");
    expect(within(button).getByTestId("glyph")).toBeTruthy();
    expect(button.getAttribute("type")).toBe("button");
    expect(styles.iconButton).toMatchObject({
      width: "28px",
      height: "28px",
      padding: "0",
    });
    expect(String(styles.iconButton.color)).toBe("var(--dsw-alias-label-secondary)");
  });
});

describe("可搜索选择器", () => {
  const options = [
    { value: "ollama", label: "Ollama Cloud" },
    { value: "deepseek", label: "DeepSeek Account" },
    { value: "openai", label: "OpenAI" },
  ];

  it("触发按钮显示当前值；空值显示'没写'那一档", () => {
    const { rerender } = render(
      <SearchSelect
        label="服务商"
        value=""
        emptyLabel="不写"
        options={options}
        searchLabel="搜索候选"
        noMatchLabel="没有匹配的候选"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "服务商" }).textContent).toBe("不写");

    rerender(
      <SearchSelect
        label="服务商"
        value="ollama"
        emptyLabel="不写"
        options={options}
        searchLabel="搜索候选"
        noMatchLabel="没有匹配的候选"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "服务商" }).textContent).toBe("Ollama Cloud");
  });

  it("打开后先给搜索框：输入即过滤，选中一项回调它的值", async () => {
    const onSelect = vi.fn();
    render(
      <SearchSelect
        label="服务商"
        value=""
        emptyLabel="不写"
        options={options}
        searchLabel="搜索候选"
        noMatchLabel="没有匹配的候选"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "服务商" }));
    // 打开就有搜索框，候选全列着（含"不写"那一档）。
    const search = screen.getByPlaceholderText("搜索候选");
    expect(await screen.findByRole("menuitem", { name: "Ollama Cloud" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "不写" })).toBeTruthy();

    fireEvent.change(search, { target: { value: "deep" } });
    expect(await screen.findByRole("menuitem", { name: "DeepSeek Account" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Ollama Cloud" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "DeepSeek Account" }));
    expect(onSelect).toHaveBeenCalledWith("deepseek");
  });

  it("一个都没匹配上：说一句而不是给一张空菜单", () => {
    render(
      <SearchSelect
        label="服务商"
        value=""
        emptyLabel="不写"
        options={options}
        searchLabel="搜索候选"
        noMatchLabel="没有匹配的候选"
        onSelect={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "服务商" }));
    fireEvent.change(screen.getByPlaceholderText("搜索候选"), { target: { value: "zzz" } });

    expect(screen.getByText("没有匹配的候选")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "OpenAI" })).toBeNull();
  });
});

describe("模型路由清单", () => {
  const routes = [
    {
      key: "ollama\u0000flash",
      provider: "ollama",
      providerName: "Ollama Cloud",
      model: "flash",
      modelName: "DeepSeek V4.1 Flash",
    },
    {
      key: "deepseek\u0000chat",
      provider: "deepseek",
      providerName: "DeepSeek Account",
      model: "chat",
      modelName: "DeepSeek Chat",
    },
  ];

  it("按 provider 分组铺开，选一条回调整条路由（服务商与模型一起）", () => {
    const onSelect = vi.fn();
    render(
      <ModelRouteList
        label="用哪个模型"
        candidates={routes}
        selectedKey={undefined}
        status="ready"
        loadingLabel="读模型中"
        errorLabel="读不出来"
        emptyLabel="还没有模型"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Ollama Cloud")).toBeTruthy();
    expect(screen.getByText("DeepSeek Account")).toBeTruthy();
    expect(screen.getByText("Ollama Cloud · ollama/flash")).toBeTruthy();

    const picked = screen.getByRole("radio", { name: "DeepSeek Chat deepseek/chat" });
    expect(picked.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(picked);
    expect(onSelect).toHaveBeenCalledWith(routes[1]);
  });

  it("当前那条打勾", () => {
    render(
      <ModelRouteList
        label="用哪个模型"
        candidates={routes}
        selectedKey={routes[0]!.key}
        status="ready"
        loadingLabel="读模型中"
        errorLabel="读不出来"
        emptyLabel="还没有模型"
        onSelect={() => {}}
      />,
    );

    expect(
      screen.getByRole("radio", { name: "DeepSeek V4.1 Flash ollama/flash" }).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });

  it("读模型中 / 读不出来 / 一条都没有：各说一句，不给空清单", () => {
    const { rerender } = render(
      <ModelRouteList
        label="用哪个模型"
        candidates={[]}
        selectedKey={undefined}
        status="loading"
        loadingLabel="读模型中"
        errorLabel="读不出来"
        emptyLabel="还没有模型"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("读模型中")).toBeTruthy();

    rerender(
      <ModelRouteList
        label="用哪个模型"
        candidates={[]}
        selectedKey={undefined}
        status="error"
        loadingLabel="读模型中"
        errorLabel="读不出来"
        emptyLabel="还没有模型"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("读不出来");

    rerender(
      <ModelRouteList
        label="用哪个模型"
        candidates={[]}
        selectedKey={undefined}
        status="ready"
        loadingLabel="读模型中"
        errorLabel="读不出来"
        emptyLabel="还没有模型"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("还没有模型")).toBeTruthy();
  });
});

describe("按钮", () => {
  it("文字不换行：本包取到的按钮带那条修饰", () => {
    render(<Button variant="outline">添加</Button>);

    const button = screen.getByRole("button", { name: "添加" });
    expect(button.textContent).toBe("添加");
    expect(styles.buttonLabel.whiteSpace).toBe("nowrap");
    expect(button.className).toContain("cls-");
  });
});
