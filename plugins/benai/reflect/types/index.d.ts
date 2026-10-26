export type Band = {
  /** offer: the rule and the three buttons. saved: one line with Open, for 8 seconds. */
  phase: 'offer' | 'saved'
  /** Changes with every new band, so an old timer never clears a newer one. */
  id: number
  /** The drafted rule, one line. */
  rule: string
  /** 3 to 6 words, kebab-case, for the vault file name. */
  slug: string
  /** The person's correction, as typed. */
  correction: string
  /** Where the rule was saved (saved phase). */
  path: string
  /** The path as shown on the band. */
  shortPath: string
  /** A line under the buttons: an error or "Already saved". */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    reflect: { band: Band | null }
  }
}
