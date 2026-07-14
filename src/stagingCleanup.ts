export function createCleanupOnce(cleanup: () => void | Promise<void>): () => Promise<void> {
  let cleanupPromise: Promise<void> | undefined;
  return () => {
    cleanupPromise ??= Promise.resolve(cleanup());
    return cleanupPromise;
  };
}
