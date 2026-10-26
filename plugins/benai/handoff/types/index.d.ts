export type StepStatus = 'wait' | 'run' | 'done' | 'fail'

export type Step = {
  label: string
  /** A short result on the right of the bar: "412 messages", "23 s". */
  detail: string
  status: StepStatus
  /** 0 to 1. */
  progress: number
}

export type Panel = {
  /** offer: the Refresh row. working: the steps. ready: the buttons. failed: the error and Try again. */
  phase: 'offer' | 'working' | 'ready' | 'failed'
  tokens: number
  steps: Step[]
  /** Spinner frame, moved by the ticker while working. */
  tick: number
  /** Where the handoff is saved, with ~ for the home folder. */
  file: string
  words: number
  error: string
  /** A line under the buttons: "Copied", "A new chat is filled in". */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    handoff: { panel: Panel | null }
  }
}
