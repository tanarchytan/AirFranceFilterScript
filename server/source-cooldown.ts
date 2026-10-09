/**
 * Per-source pause after bot protection keeps blocking us (Akamai 403 / 429 even after the
 * source's own retries): 10 minutes, doubling per repeat block up to an hour, reset by any
 * success. Hammering a blocking site only extends the block.
 */
const BASE_MS = 10 * 60_000
const MAX_MS = 60 * 60_000

export class SourceCoolingDownError extends Error {
  constructor(readonly label: string, readonly remainingMs: number) {
    super(`${label} is blocking requests from this browser, so Ratline pauses it for ${Math.ceil(remainingMs / 60_000)} min. Try again after that.`)
    this.name = 'SourceCoolingDownError'
  }
}

export const isBlockError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /HTML challenge|Access Denied|HTTP 403|HTTP 429|\b429\b/i.test(message)
}

export class SourceCooldown {
  private readonly state = new Map<string, { until: number; stepMs: number }>()
  private readonly now: () => number

  constructor({ now = () => Date.now() }: { now?: () => number } = {}) {
    this.now = now
  }

  remainingMs(source: string): number {
    const entry = this.state.get(source)
    return entry ? Math.max(0, entry.until - this.now()) : 0
  }

  recordBlock(source: string): void {
    const previous = this.state.get(source)
    const stepMs = previous ? Math.min(previous.stepMs * 2, MAX_MS) : BASE_MS
    this.state.set(source, { until: this.now() + stepMs, stepMs })
  }

  recordSuccess(source: string): void {
    this.state.delete(source)
  }

  assertAvailable(source: string, label: string): void {
    const remaining = this.remainingMs(source)
    if (remaining > 0) throw new SourceCoolingDownError(label, remaining)
  }
}

export const sourceCooldowns = new SourceCooldown()
