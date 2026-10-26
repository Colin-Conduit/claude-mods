// Conduit change: one place for what differs between macOS, Windows and Linux, so the mod runs on all three.

/** True when the plugin sits on a Windows drive or share (C:\Users\..., \\server\...). */
export const isWindows = (root: string) => /^[A-Za-z]:[\\/]|^\\\\/.test(root)

/** The home folder: the plugin's root up to its .claude folder, split on either slash. */
export const homeOf = (root: string) => root.split(/[\\/]\.claude[\\/]/)[0] ?? ''
