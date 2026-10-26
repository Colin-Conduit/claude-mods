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

/** Deletes a file; a missing file is no error. $.fs has no delete, so it is the system's own command. */
export async function removeFile($: Host, path: string) {
  if (isWindows($.plugin.root)) await $.process.run(['cmd.exe', '/d', '/c', 'del', '/f', '/q', path.replace(/\//g, '\\')])
  else await $.process.run(['rm', '-f', path])
}

const isLink = (target: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(target)

/** Opens a file or a link in its default app: open on macOS, the shell's handler on Windows, xdg-open on Linux. */
export async function openWith($: Host, target: string) {
  const os = await osOf($)
  // No shell on Windows, so a link's & and % reach the handler as they are.
  if (os === 'windows') return $.process.run(['rundll32.exe', 'url.dll,FileProtocolHandler', isLink(target) ? target : target.replace(/\//g, '\\')])
  return $.process.run([os === 'mac' ? 'open' : 'xdg-open', target])
}

// Reads standard input as UTF-8 bytes, so accents and symbols survive the console's code page.
const WIN_CLIP =
  '$m = New-Object System.IO.MemoryStream; [Console]::OpenStandardInput().CopyTo($m); ' +
  'Set-Clipboard -Value ([System.Text.Encoding]::UTF8.GetString($m.ToArray()))'

/** Puts text on the clipboard: pbcopy on macOS, PowerShell on Windows, wl-copy or xclip on Linux. */
export async function clipboard($: Host, text: string) {
  const os = await osOf($)
  if (os === 'mac') return $.process.run(['pbcopy'], { stdin: text })
  if (os === 'windows') return $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', WIN_CLIP], { stdin: text })
  const wayland = await $.process.run(['wl-copy'], { stdin: text, timeoutMs: 5000 }).catch(() => undefined)
  if (wayland?.exitCode === 0) return wayland
  return $.process.run(['xclip', '-selection', 'clipboard'], { stdin: text, timeoutMs: 5000 })
}

/** The paste shortcut to name in a hint. */
export const pasteKey = (os: Os) => (os === 'mac' ? '⌘V' : 'Ctrl+V')
