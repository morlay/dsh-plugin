// 动作的反馈状态：提示 / 失败 / 在途收成一处，页面不再各存一份。
//
// 失败文案由调用方给（不同字典的码表不同），这里只管状态转移：动作开始清掉上一次的提示并置在途，
// 结束时落成败文案并复位在途。
import { useCallback, useState } from "react";

export interface ActionFeedback {
  readonly notice: string | null;
  readonly failure: string | null;
  readonly busy: boolean;
  // 发起一个动作；`onSettled` 成败都跑（收弹窗），`onSuccess` 只成功后跑（重拉列表、移焦点）。
  run: (action: Promise<unknown>, options?: RunOptions) => void;
  // 不发起动作的成功提示（动作结果要参与文案时用）。
  notify: (message: string) => void;
  // 不发请求的拒绝：本地校验失败也走同一条失败通道，用户看到的与宿主拒绝一样。
  reject: (reason: string) => void;
  clear: () => void;
}

export interface RunOptions {
  // 成功后的固定提示文案。
  readonly success?: string;
  // 动作结束（成败都）后的收尾。
  readonly onSettled?: () => void;
  // 成功后的额外收尾。
  readonly onSuccess?: () => void;
}

export function useActionFeedback(describeFailure: (error: unknown) => string): ActionFeedback {
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clear = useCallback(() => {
    setNotice(null);
    setFailure(null);
  }, []);

  const notify = useCallback((message: string) => {
    setFailure(null);
    setNotice(message);
  }, []);

  const reject = useCallback((reason: string) => {
    setNotice(null);
    setFailure(reason);
  }, []);

  const run = useCallback(
    (action: Promise<unknown>, options: RunOptions = {}) => {
      setNotice(null);
      setFailure(null);
      setBusy(true);
      void action
        .then(
          () => {
            if (options.success !== undefined) setNotice(options.success);
            options.onSuccess?.();
          },
          (error: unknown) => {
            setFailure(describeFailure(error));
          },
        )
        .finally(() => {
          setBusy(false);
          options.onSettled?.();
        });
    },
    [describeFailure],
  );

  return { notice, failure, busy, run, notify, reject, clear };
}
