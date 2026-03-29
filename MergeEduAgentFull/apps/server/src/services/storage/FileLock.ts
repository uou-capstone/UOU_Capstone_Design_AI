export class FileLock {
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
