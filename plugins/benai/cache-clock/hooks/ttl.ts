// Conduit change: replaces bin/ttl.py, so the cache length is read with no python3 and on Windows too.
import type { EngineInterface } from 'claude-code'

import { isWindows } from './platform'

// The transcript's last 3 MB holds the newest replies. $.fs.read stops at 4 MiB, so a bigger
// file's tail comes from the system: tail on macOS and Linux, PowerShell on Windows.
const TAIL = 3_000_000
const READ_MAX = 4 * 1024 * 1024
const WIN_TAIL =
  "$f = [System.IO.File]::Open($env:CACHE_CLOCK_FILE, 'Open', 'Read', 'ReadWrite'); $n = [Math]::Min($f.Length, " + TAIL + '); ' +
  "[void]$f.Seek(-$n, 'End'); $b = New-Object byte[] $n; $r = 0; " +
  'while ($r -lt $n) { $k = $f.Read($b, $r, $n - $r); if ($k -le 0) { break }; $r += $k }; ' +
  '$f.Close(); [Console]::OpenStandardOutput().Write($b, 0, $r)'

/** Reads a transcript's last 3 MB, the first (cut) line dropped when it was cut. */
export async function tailOf($: Pick<EngineInterface, 'plugin' | 'process' | 'fs'>, path: string) {
  const { size } = await $.fs.stat(path)
  if (size <= READ_MAX) {
    const text = String(await $.fs.read(path))
    if (text.length <= TAIL) return text
    // A cut line at the start is dropped.
    return text.slice(-TAIL).split('\n').slice(1).join('\n')
  }
  const r = isWindows($.plugin.root)
    ? await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', WIN_TAIL], { env: { CACHE_CLOCK_FILE: path } })
    : await $.process.run(['tail', '-c', String(TAIL), path])
  if (r.exitCode !== 0) throw new Error(r.stderr.slice(0, 200) || `exit ${r.exitCode}`)
  return r.stdout.split('\n').slice(1).join('\n')
}

/** 1h, 5m or unknown: the newest main-chat reply that wrote to the cache says which. */
export function ttlIn(text: string): 'unknown' | '5m' | '1h' {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? ''
    if (!line.includes('"assistant"')) continue
    let j: { type?: unknown; isSidechain?: unknown; message?: { usage?: { cache_creation?: Record<string, unknown> | null } | null } | null }
    try {
      j = JSON.parse(line) as typeof j
    } catch {
      continue
    }
    if (!j || j.type !== 'assistant' || j.isSidechain) continue
    const cc = j.message?.usage?.cache_creation ?? {}
    if (Number(cc.ephemeral_1h_input_tokens ?? 0) > 0) return '1h'
    if (Number(cc.ephemeral_5m_input_tokens ?? 0) > 0) return '5m'
  }
  return 'unknown'
}
