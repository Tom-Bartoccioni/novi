export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** Sérialise les appels et impose un intervalle minimal de 1000/perSecond ms entre deux départs. */
export function createLimiter(perSecond: number): Limiter {
  const interval = 1000 / perSecond;
  let last = 0;
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(async () => {
      const wait = last + interval - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return fn();
    });
    queue = next.catch(() => undefined);
    return next;
  };
}
