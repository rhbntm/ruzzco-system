/**
 * Synchronous single-flight lock for actions that must happen at most once per
 * deliberate user gesture (recording a sale).
 *
 * React state cannot guard this: two taps in the same frame both run before the
 * re-render that disables the button. The check-and-set here happens synchronously
 * in the first line of run() — an async function executes synchronously up to its
 * first await — so a second call in the same tick already sees the lock taken.
 *
 * After a successful action the lock stays held for `holdAfterSuccessMs`, because a
 * local sale is written in milliseconds and a double tap ~100 ms apart would
 * otherwise land after the release. After a failure it is released immediately so
 * the user can retry.
 */

export type SubmitLockResult<T> =
  | { status: "busy" }
  | { status: "done"; value: T }
  | { status: "failed"; error: unknown };

export type SubmitLock = {
  readonly busy: boolean;
  run<T>(action: () => Promise<T>): Promise<SubmitLockResult<T>>;
};

export function createSubmitLock(options: {
  holdAfterSuccessMs: number;
  onChange?: (busy: boolean) => void;
}): SubmitLock {
  let busy = false;

  const release = () => {
    busy = false;
    options.onChange?.(false);
  };

  return {
    get busy() {
      return busy;
    },
    async run<T>(action: () => Promise<T>): Promise<SubmitLockResult<T>> {
      // Check-and-set before any await: this is the correctness guarantee.
      if (busy) return { status: "busy" };
      busy = true;
      options.onChange?.(true);

      let value: T;
      try {
        value = await action();
      } catch (error) {
        release();
        return { status: "failed", error };
      }
      if (options.holdAfterSuccessMs > 0) {
        setTimeout(release, options.holdAfterSuccessMs);
      } else {
        release();
      }
      return { status: "done", value };
    },
  };
}
