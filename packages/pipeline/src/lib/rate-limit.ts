export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** Espace les départs d'au moins 1000/perSecond ms ; n'attend pas la fin des appels. */
export function createLimiter(perSecond: number): Limiter {
  const interval = 1000 / perSecond;
  let last = 0;
  let queue: Promise<void> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const start = queue.then(async () => {
      const wait = last + interval - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    queue = start;
    return start.then(fn);
  };
}
