/** A short line under the list after a press: "Cache Clock is off in every chat." */
export type Note = string

declare module 'claude-code' {
  interface PluginState {
    mods: { note: Note }
  }
}
