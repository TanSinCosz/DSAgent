import { AsyncLocalStorage } from 'async_hooks'

const cwdOverrideStorage = new AsyncLocalStorage<string>()
const originalCwd = process.cwd()

export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
    return cwdOverrideStorage.run(cwd, fn)
}

export function getCwd(): string {
  const overridden = cwdOverrideStorage.getStore()
  if (overridden) return overridden

  try {
    return process.cwd()
  } catch {
    return originalCwd
  }
}