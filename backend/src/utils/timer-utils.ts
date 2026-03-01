/**
 * Resolves after the given number of milliseconds.
 * Wrapping setTimeout in a Promise makes it easy to swap out with
 * Vitest/Jest fake timers in tests.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns the current Unix epoch in *seconds* (floating-point).
 * Delegating to Date.now() here lets fake timers override it cleanly in tests.
 */
export function nowSeconds(): number {
  return Date.now() / 1000;
}
