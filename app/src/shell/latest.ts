// Only the newest read counts. A snapshot is re-read from several places at once — a timer, a `*_changed` event, the
// window coming forward — and Tauri does not promise that two `invoke`s finish in the order they began: a read that
// started before the collector wrote the mirror can land after one that started afterwards, and would put the old
// words back on screen until the next tick (a done card reading "working" again, `now` running backwards). Pure, so
// latest.test.ts holds it without React.

/**
 * Wraps `load` so that each call supersedes the ones before it: an answer, or a failure, from a call that a later one
 * has overtaken is dropped. Returns the function to call for a fresh read.
 */
export function latestOnly<T>(load: () => Promise<T>, deliver: (value: T) => void, fail: (e: unknown) => void = () => {}): () => void {
  let seq = 0;
  return () => {
    const mine = ++seq;
    load().then(
      (value) => {
        if (mine === seq) deliver(value);
      },
      (e: unknown) => {
        if (mine === seq) fail(e);
      },
    );
  };
}
