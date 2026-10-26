export type ScreenShareMode = 'on' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'screen-share': {
      /** True while Screen-Share Mode hides private data on screen. */
      on: boolean
    }
  }
}
