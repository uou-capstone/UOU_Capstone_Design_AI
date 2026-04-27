export class FileLock {
  private static readonly queues = new Map<string, Promise<void>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = FileLock.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.catch(() => undefined).then(() => gate);
    FileLock.queues.set(key, next);

    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (FileLock.queues.get(key) === next) {
        FileLock.queues.delete(key);
      }
    }
  }
}
