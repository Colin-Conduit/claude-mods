export type Clock = {
  /** When the last main-chat reply ended, in ms. 0 before the first reply. */
  lastEnd: number
  /** How long the cache stays warm after a reply, in ms. */
  ttlMs: number
  /** detected: read from this chat's log. default: 5 min guess. demo: 60 s for filming. */
  ttlSource: 'detected' | 'default' | 'demo'
  /** Context tokens the next message re-sends. */
  tokens: number
  /** The clock's last tick, in ms, so the band redraws every second. */
  now: number
  /** A line under the band after a button press. */
  note: string
}

export type Warm = {
  /** When keep warm was turned on, in ms: it stops by itself 2 hours later. */
  startedAt: number
  /** Pings sent so far: it stops by itself after 30. */
  pings: number
  /** Cache read tokens of the last ping. */
  read: number
  /** Cache write tokens of the last ping. */
  write: number
  /** True when the last ping wrote the chat to the cache again: it had gone cold. */
  cold: boolean
  /** Why the last ping failed, or ''. */
  error: string
  /** True while a ping is out. */
  sending: boolean
  /** Failed pings in a row: it stops after 3. */
  failures: number
  /** No new ping before this time, in ms (after a failure). */
  retryAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': { clock: Clock | null; warm: Warm | null }
  }
}
