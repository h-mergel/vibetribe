export const PARENT_CHECK_MS = 5_000;

/**
 * Stream Deck starts the plugin and does not always stop it: when the parent is gone the plugin
 * would linger as an orphan holding the hub port. Calls `onGone` once, then stops watching.
 * Returns a function that stops the watch.
 */
export function watchParent(
  ppid: number,
  isAlive: (pid: number) => boolean,
  onGone: () => void,
): () => void {
  const handle = setInterval(() => {
    if (isAlive(ppid)) return;
    clearInterval(handle);
    onGone();
  }, PARENT_CHECK_MS);
  handle.unref();
  return () => clearInterval(handle);
}
