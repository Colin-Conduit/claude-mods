// Conduit change: one place for what differs between macOS, Windows and Linux, so the mod runs on all three.
import type { EngineInterface } from 'claude-code'

/** The two parts of $ these helpers use, so a test can hand in a stand-in. */
export type Host = Pick<EngineInterface, 'plugin' | 'process'>
export type Os = 'mac' | 'windows' | 'linux'

/** True when the plugin sits on a Windows drive or share (C:\Users\..., \\server\...). */
export const isWindows = (root: string) => /^[A-Za-z]:[\\/]|^\\\\/.test(root)

/** The home folder: the plugin's root up to its .claude folder, split on either slash. */
export const homeOf = (root: string) => root.split(/[\\/]\.claude[\\/]/)[0] ?? ''

/** Which system the session runs on: Windows from the plugin's path, macOS or Linux from uname. */
export async function osOf($: Host): Promise<Os> {
  if (isWindows($.plugin.root)) return 'windows'
  const r = await $.process.run(['uname', '-s']).catch(() => undefined)
  return r?.stdout.trim() === 'Darwin' ? 'mac' : 'linux'
}

const isLink = (target: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(target)

/** Opens a file or a link in its default app: open on macOS, the shell's handler on Windows, xdg-open on Linux. */
export async function openWith($: Host, target: string) {
  const os = await osOf($)
  // No shell on Windows, so a link's & and % reach the handler as they are.
  if (os === 'windows') return $.process.run(['rundll32.exe', 'url.dll,FileProtocolHandler', isLink(target) ? target : target.replace(/\//g, '\\')])
  return $.process.run([os === 'mac' ? 'open' : 'xdg-open', target])
}
