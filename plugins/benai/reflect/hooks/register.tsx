import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Band } from '../types'

const BAND = { plugin: 'reflect', key: 'band' } as const

const DEFAULT_FOLDER = '~/Documents/rules'
const CANCEL = 'Cancel'
const HEADING = '## Rules from corrections'
const SAVED_MS = 8000

const ACCENT = '#d97757'
const GOOD = '#16a34a'
const BAD = '#dc2626'

// The cheap first pass: only prompts with one of these go on to the model.
const HINTS = [
  /\bno\b/i,
  /\bdon'?t\b/i,
  /\bdo not\b/i,
  /\bnever\b/i,
  /\bstop\b/i,
  /\binstead\b/i,
  /\bi said\b/i,
  /\bwrong\b/i,
  /\btoo (long|short|much|many|wordy|formal|casual)\b/i,
  /\bshorter\b/i,
  /\bnot like that\b/i,
  /\balways\b/i,
  /\buse\b.{1,40}\bnot\b/i,
  /\bremove\b/i,
  /\bavoid\b/i,
]

// Module variables reset on a reload; the band lives in $.state.
let home = ''
// The rules_folder option from the config menu; empty means ask once and remember.
let configured = ''
let enabled = true
// Bumped on every prompt, so a slow draft for an older prompt is dropped.
let gen = 0
let turnDone = true
let pending: { rule: string; slug: string; correction: string } | null = null
let nextId = 1

// The /mods switchboard turns this mod off in every chat with switches.json.
const NAME = 'reflect'
let off = false

async function readSwitch($: EngineInterface) {
  let now = false
  try {
    const path = `${$.plugin.root.split('/.claude/')[0] ?? ''}/.claude/mods/switches.json`
    if (await $.fs.exists(path)) {
      const json = JSON.parse(String(await $.fs.read(path))) as Record<string, unknown>
      now = json[NAME] === false
    }
  } catch {
    now = off
  }
  if (now === off) return
  off = now
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state change redraws anyway.
  }
  if (off) pending = null
}

const tilde = (p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p)

async function getBand($: EngineInterface): Promise<Band | null> {
  const { value } = await $.state.get(BAND)
  return value ?? null
}

async function setBand($: EngineInterface, b: Band | null) {
  await $.state.set(BAND, b)
}

async function log($: EngineInterface, what: string, err: unknown) {
  try {
    const path = `${home}/.claude/mods-logs/reflect.log`
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const msg = err instanceof Error ? err.message : String(err)
    await $.fs.write(path, `${old}${new Date(await $.clock.now()).toISOString()} ${what}: ${msg}\n`)
  } catch {
    // Nowhere left to report it.
  }
}

async function today($: EngineInterface) {
  const d = new Date(await $.clock.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function looksLikeCorrection(text: string) {
  const t = text.trim()
  if (!t || t.startsWith('/') || t.length > 1500) return false
  return HINTS.some(re => re.test(t))
}

// Plain text rules: no em or en dashes, never the banned word, one line, a full stop.
function cleanRule(raw: string) {
  let r = raw
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\bship(s|ped|ping)?\b/gi, (_m, end: string | undefined) => {
      const e = (end ?? '').toLowerCase()
      return e === 's' ? 'publishes' : e === 'ped' ? 'published' : e === 'ping' ? 'publishing' : 'publish'
    })
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-*"'`\s]+|["'`\s]+$/g, '')
  if (!r) return ''
  r = r[0]!.toUpperCase() + r.slice(1)
  if (!/[.!?]$/.test(r)) r += '.'
  return r
}

const STOP = new Set(['a', 'an', 'the', 'in', 'on', 'of', 'to', 'for', 'and', 'or', 'with', 'when', 'any', 'all', 'my', 'your'])

function cleanSlug(raw: string, rule: string) {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .split('-')
      .filter(Boolean)
  let w = words(raw)
  if (w.length < 2) w = words(rule).filter(x => !STOP.has(x))
  return w.slice(0, 6).join('-').slice(0, 60) || 'rule'
}

function draftPrompt(correction: string, lastReply: string) {
  return `A person corrected an AI assistant. Turn the correction into ONE general rule the assistant should follow in every future chat.

The assistant's last reply (first 1,500 characters):
<reply>
${lastReply}
</reply>

The person's correction:
<correction>
${correction}
</correction>

Rules for the rule:
- One line, plain imperative English, under 20 words. Example: Never use em dashes in newsletter copy.
- General enough to apply next time, specific enough to act on. Name the kind of work it applies to when that matters.
- No em dashes. Never use the word "ship".

Also give a 3 to 6 word kebab-case slug for it, for example no-em-dashes-in-newsletters.

Reply with JSON only: {"rule": "...", "slug": "..."}
If the message holds no lasting lesson (a one-off fix to this task only), reply {"rule": "NONE", "slug": ""}.`
}

function parseDraft(text: string): { rule: string; slug: string } | null {
  const m = /\{[\s\S]*\}/.exec(text)
  let rule = ''
  let slug = ''
  if (m) {
    try {
      const j = JSON.parse(m[0]) as { rule?: unknown; slug?: unknown }
      rule = typeof j.rule === 'string' ? j.rule : ''
      slug = typeof j.slug === 'string' ? j.slug : ''
    } catch {
      // Fall through to the first line.
    }
  }
  if (!rule) rule = text.split('\n').find(l => l.trim()) ?? ''
  if (!rule || /^none\.?$/i.test(rule.trim())) return null
  const clean = cleanRule(rule)
  if (!clean || /^none\.?$/i.test(clean)) return null
  return { rule: clean, slug: cleanSlug(slug, clean) }
}

function lastAssistantText(messages: readonly SessionMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!
    if (m.role === 'assistant' && m.text.trim()) return m.text
  }
  return ''
}

async function show($: EngineInterface, d: { rule: string; slug: string; correction: string }) {
  if (!enabled) return
  const id = nextId++
  await setBand($, { phase: 'offer', id, rule: d.rule, slug: d.slug, correction: d.correction, path: '', shortPath: '', note: '' })
}

// Runs in the background after a prompt: filter, classify, draft.
async function check($: EngineInterface, text: string, mine: number) {
  if (!looksLikeCorrection(text)) return
  const messages = await $.session.messages()
  const lastReply = lastAssistantText(messages)
  if (!lastReply) return
  const kind = await $.model.classify(text, ['correction', 'other'])
  if (kind !== 'correction' || mine !== gen) return
  const r = await $.model.complete({ model: 'sonnet', prompt: draftPrompt(text, lastReply.slice(0, 1500)), maxTokens: 300, timeoutMs: 30_000 })
  if (!r.isAnswered) throw new Error(`draft failed: ${r.reason}`)
  const draft = parseDraft(r.text)
  if (!draft || mine !== gen) return
  const d = { ...draft, correction: text.trim() }
  // Show it when the turn ends; if it already has, show it now.
  if (turnDone) await show($, d)
  else pending = d
}

// Adds the rule under the heading at the end of the file, keeping every other line.
function withRule(old: string, line: string) {
  const lines = old.split('\n')
  const at = lines.findIndex(l => l.trim() === HEADING)
  if (at === -1) {
    const base = old.replace(/\s+$/, '')
    return `${base}${base ? '\n\n' : ''}${HEADING}\n\n${line}\n`
  }
  let end = lines.length
  for (let k = at + 1; k < lines.length; k += 1) {
    if (/^#{1,2}\s/.test(lines[k]!)) {
      end = k
      break
    }
  }
  let last = end
  while (last > at + 1 && !lines[last - 1]!.trim()) last -= 1
  const before = lines.slice(0, last)
  if (last === at + 1) before.push('')
  const after = lines.slice(end)
  const out = [...before, line, ...(after.length ? ['', ...after] : [])].join('\n')
  return out.endsWith('\n') ? out : `${out}\n`
}

async function saveEverywhere($: EngineInterface, b: Band) {
  const path = `${home}/.claude/CLAUDE.md`
  const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
  const already = old.split('\n').some(l => l.startsWith(`- ${b.rule} (added `))
  if (already) return { path, note: 'Already saved' }
  const line = `- ${b.rule} (added ${await today($)})`
  const next = withRule(old, line)
  const oldLines = old.split('\n').filter(l => l.trim())
  const nextLines = new Set(next.split('\n'))
  if (next.length < old.length || oldLines.some(l => !nextLines.has(l))) throw new Error('the new CLAUDE.md would lose lines; nothing written')
  await $.fs.write(path, next)
  const back = String(await $.fs.read(path))
  if (back !== next) throw new Error('CLAUDE.md did not read back as written')
  return { path, note: '' }
}

// Turns ~ into the home folder and drops a trailing slash.
function expand(p: string) {
  let r = p.trim()
  if (r === '~') r = home
  else if (r.startsWith('~/')) r = `${home}${r.slice(1)}`
  return r.replace(/\/+$/, '')
}

// The folder rule notes go to: the rules_folder option, else the remembered answer, else ask once.
async function pickFolder($: EngineInterface) {
  if (configured.trim()) return expand(configured)
  const saved = await $.store.get('folder')
  if (typeof saved === 'string' && saved.trim()) return expand(saved)
  let answer = ''
  try {
    // The dialog needs two options; any other path is typed under Other.
    answer = (await $.ui.ask('Which folder should rule notes go in?', { options: [DEFAULT_FOLDER, CANCEL], header: 'Rules folder' })).trim()
  } catch {
    // A cancelled dialog saves nothing.
    return ''
  }
  if (!answer || answer === CANCEL || (!answer.startsWith('/') && !answer.startsWith('~'))) return ''
  const dir = expand(answer)
  if (!dir) return ''
  await $.store.set('folder', answer)
  return dir
}

function vaultNote(b: Band, date: string) {
  const title = b.rule.replace(/[.!?]+$/, '')
  const why = b.correction.replace(/\s+/g, ' ').trim().slice(0, 200).replace(/"/g, "'")
  return `---
type: rule
status: active
date: ${date}
source: correction in a Claude Code chat
tags: [rule]
---

# ${title}

${b.rule}

Why: "${why}"
`
}

async function saveToVault($: EngineInterface, b: Band) {
  const dir = await pickFolder($)
  if (!dir) return null
  // $.fs.write creates the folder and any missing parents.
  let path = `${dir}/${b.slug}.md`
  for (let k = 2; (await $.fs.exists(path)) && k < 100; k += 1) path = `${dir}/${b.slug}-${k}.md`
  const text = vaultNote(b, await today($))
  await $.fs.write(path, text)
  const back = String(await $.fs.read(path))
  if (back !== text) throw new Error('the rule file did not read back as written')
  return { path, short: tilde(path) }
}

async function hideLater($: EngineInterface, id: number) {
  await $.clock.sleep(SAVED_MS)
  const b = await getBand($)
  if (b && b.id === id && b.phase === 'saved') await setBand($, null)
}

async function markSaved($: EngineInterface, b: Band, path: string, shortPath: string, note: string) {
  const id = nextId++
  await setBand($, { ...b, phase: 'saved', id, path, shortPath, note })
  void hideLater($, id).catch(err => log($, 'hide', err))
}

async function fail($: EngineInterface, b: Band, what: string, err: unknown) {
  await log($, what, err)
  await setBand($, { ...b, note: `Could not save: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}` })
}

export const register: Register = (on, options) => {
  configured = typeof options.rules_folder === 'string' ? options.rules_folder : ''
  on('session.start', async ($, e, next) => {
    home = $.plugin.root.split('/.claude/')[0] ?? ''
    await $.command.register({ name: 'reflect', description: 'Turn reflect on or off. /reflect folder forgets the remembered rules folder', argumentHint: '[folder]' })
    const saved = await $.store.get('enabled')
    enabled = saved !== false
    await readSwitch($).catch(() => undefined)
    $.clock.every(3000, () => {
      void readSwitch($).catch(() => undefined)
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (off) return next(e)
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    gen += 1
    turnDone = false
    pending = null
    const mine = gen
    const text = e.text
    // A new prompt makes an unanswered offer stale.
    void (async () => {
      const b = await getBand($)
      if (b?.phase === 'offer') await setBand($, null)
    })().catch(err => log($, 'clear', err))
    if (enabled) void check($, text, mine).catch(err => log($, 'check', err))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (off) return next(e)
    const result = await next(e)
    if (e.agentId === undefined) {
      turnDone = true
      if (pending) {
        const d = pending
        pending = null
        void show($, d).catch(err => log($, 'show', err))
      }
    }
    return result
  })

  on('command.run', { command: 'reflect' }, async ($, e) => {
    if (off) return { text: 'Reflect is off. Turn it on with /mods.' }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'folder') {
      await $.store.delete('folder')
      return {
        text: configured.trim()
          ? `Remembered folder cleared. Save to vault still uses the rules_folder setting: ${configured.trim()}`
          : 'Remembered folder cleared. Reflect asks again at the next Save to vault.',
      }
    }
    enabled = !enabled
    await $.store.set('enabled', enabled)
    if (!enabled) {
      pending = null
      await setBand($, null)
    }
    return { text: enabled ? 'Reflect is on. Corrections get a Save this as a rule? offer.' : 'Reflect is off. Type /reflect to turn it back on.' }
  })

  on('ui.press', { plugin: 'reflect', element: 'everywhere' }, async ($, e) => {
    const b = await getBand($)
    if (!b || b.phase !== 'offer') return { element: e.element }
    try {
      const r = await saveEverywhere($, b)
      await markSaved($, b, r.path, tilde(r.path), r.note)
    } catch (err) {
      await fail($, b, 'save everywhere', err)
    }
    return { element: e.element }
  })

  on('ui.press', { plugin: 'reflect', element: 'vault' }, async ($, e) => {
    const b = await getBand($)
    if (!b || b.phase !== 'offer') return { element: e.element }
    try {
      const r = await saveToVault($, b)
      if (!r) {
        await setBand($, { ...b, note: 'No folder picked. Nothing saved.' })
      } else {
        await markSaved($, b, r.path, r.short, '')
      }
    } catch (err) {
      await fail($, b, 'save to vault', err)
    }
    return { element: e.element }
  })

  on('ui.press', { plugin: 'reflect', element: 'skip' }, async ($, e) => {
    await setBand($, null)
    return { element: e.element }
  })

  on('ui.press', { plugin: 'reflect', element: 'open' }, async ($, e) => {
    const b = await getBand($)
    if (b?.path) await $.process.run(['open', b.path])
    return { element: e.element }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (off || !enabled || e.props.hasSurvey || e.props.isWorking) return next(e)
    const b = await getBand($)
    if (!b) return next(e)
    const rest = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const noop = () => undefined

    if (b.phase === 'saved') {
      return (
        <Box flexDirection="column">
          {rest}
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text wrap="truncate-middle">
              <Text color={GOOD}>✓</Text>
              <Text> {b.note ? `${b.note} in` : 'Saved to'} </Text>
              <Text dimColor>{b.shortPath}</Text>
            </Text>
            <Button key="open" label="Open" onPress={noop} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="column">
          <Text>
            <Text color={ACCENT}>●</Text>
            <Text bold> Save this as a rule?</Text>
          </Text>
          <Text>"{b.rule}"</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="everywhere" label="Save everywhere" variant="primary" onPress={noop} />
            <Button key="vault" label="Save to vault" variant="secondary" onPress={noop} />
            <Button key="skip" label="Skip" role="dismiss" onPress={noop} />
          </Box>
          {b.note ? <Text color={BAD}>{b.note}</Text> : null}
        </Box>
      </Box>
    )
  })
}
