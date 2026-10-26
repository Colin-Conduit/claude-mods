// Conduit change: removed the Claude Pet hand-off; Start new chat always uses the app link.
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Panel, Step } from '../types'

// One key for the whole band: offer, steps, buttons.
const PANEL = { plugin: 'handoff', key: 'panel' } as const

// The Refresh offer opens at this many tokens. Closing a finished handoff moves it up by SNOOZE.
// Chats auto-compact near 300k to 324k, so the offer must open well before that.
const OFFER_AT = 250_000
const SNOOZE = 100_000
const POLL_MS = 5000
const TICK_MS = 110
// A quick step still shows its bar filling for this long, so the rows read one by one.
const MIN_STEP_MS = 650
// The handoff step's bar creeps toward full on this time scale while the model writes.
const WRITE_SCALE_MS = 40_000
const BAR = 18

const ACCENT = '#d97757'
const GOOD = '#16a34a'
const BAD = '#dc2626'
const SPIN = ['◐', '◓', '◑', '◒']

const LABELS = [
  'Reading the conversation',
  'Finding the files you used',
  'Listing skills, tools and links',
  'Writing the handoff',
  'Saving and checking',
]

// Module variables reset on a reload; the band itself lives in $.state.
let sid = ''
let home = ''
let busy = false
// The model asked for a refresh in the middle of its turn: it starts when the turn ends,
// because a fork while a tool call is open would send a tool use with no result.
let pending = false
let snoozedTo = OFFER_AT
let handoffText = ''
let handoffPath = ''
let ticker: { cancel: () => void } | null = null
let writeStartedAt = 0
let writeMs = 0
let running = -1
let stepStartedAt = 0

// The /mods switchboard turns this mod off in every chat with switches.json.
// "handoff:hidden": true in the same file stops the automatic Refresh offer in every chat.
// Show (/refresh, or /mods leaving .open-handoff-<sessionId>) brings the offer up now.
const NAME = 'handoff'
const HIDE_KEY = `${NAME}:hidden`
let off = false
let hidden = false
// The offer was asked for (Show or /refresh): it stays whatever the token count.
let forced = false

const switchesPath = ($: EngineInterface) => `${$.plugin.root.split('/.claude/')[0] ?? ''}/.claude/mods/switches.json`

async function readSwitches($: EngineInterface): Promise<Record<string, unknown>> {
  const path = switchesPath($)
  if (!(await $.fs.exists(path))) return {}
  const json = JSON.parse(String(await $.fs.read(path))) as unknown
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
}

async function readSwitch($: EngineInterface) {
  let nowOff = off
  let nowHidden = hidden
  try {
    const json = await readSwitches($)
    nowOff = json[NAME] === false
    nowHidden = json[HIDE_KEY] === true
  } catch {
    // A broken or missing file changes nothing.
  }
  if (nowOff === off && nowHidden === hidden) return
  off = nowOff
  const hiding = nowHidden && !hidden
  hidden = nowHidden
  if (hiding) await dropOffer($)
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state change redraws anyway.
  }
}

// Hidden: an offer on screen goes; the steps and a finished handoff stay.
async function dropOffer($: EngineInterface) {
  forced = false
  const p = await getPanel($)
  if (p?.phase === 'offer') await setPanel($, null)
}

// Read, change, write the whole file, so every chat sees the choice within 3 s.
async function setHidden($: EngineInterface, value: boolean) {
  try {
    const json = await readSwitches($)
    if (value) json[HIDE_KEY] = true
    else delete json[HIDE_KEY]
    await $.process.run(['mkdir', '-p', `${home}/.claude/mods`])
    await $.fs.write(switchesPath($), `${JSON.stringify(json, null, 2)}\n`)
  } catch (err) {
    await log($, `save hidden failed: ${String(err)}`)
  }
  hidden = value
  if (value) await dropOffer($)
}

// Brings the Refresh offer up now, whatever the token count.
async function showOffer($: EngineInterface) {
  const p = await getPanel($)
  // Steps running, or a handoff ready or failed: that panel is already up.
  if (busy || (p && p.phase !== 'offer')) return
  const { context } = await $.session.usage()
  forced = true
  await setPanel($, { phase: 'offer', tokens: context.tokens ?? 0, steps: freshSteps(), tick: 0, file: '', words: 0, error: '', note: '' })
}

// The /mods switchboard asks for the offer by leaving an empty file for this chat.
async function checkOpen($: EngineInterface) {
  if (!sid) return
  const path = `${home}/.claude/mods/.open-${NAME}-${sid}`
  if (!(await $.fs.exists(path).catch(() => false))) return
  await $.process.run(['rm', '-f', path])
  if (!off) await showOffer($)
}

async function poll($: EngineInterface) {
  await readSwitch($)
  await checkOpen($).catch(err => log($, `open request failed: ${String(err)}`))
}

const short = (tokens: number) => `${Math.round(tokens / 1000)}k`
const tilde = (p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p)
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

function freshSteps(): Step[] {
  return LABELS.map(label => ({ label, detail: '', status: 'wait', progress: 0 }))
}

async function getPanel($: EngineInterface): Promise<Panel | null> {
  const { value } = await $.state.get(PANEL)
  return value ?? null
}

async function setPanel($: EngineInterface, p: Panel | null) {
  await $.state.set(PANEL, p)
}

async function patchStep($: EngineInterface, i: number, change: Partial<Step>) {
  const p = await getPanel($)
  if (!p) return
  const steps = p.steps.map((s, k) => (k === i ? { ...s, ...change } : s))
  await setPanel($, { ...p, steps })
}

// Moves the spinner and the running step's bar.
async function tick($: EngineInterface) {
  const p = await getPanel($)
  if (!p || p.phase !== 'working') return
  const now = await $.clock.now()
  const steps = p.steps.map((s, k) => {
    if (k !== running || s.status !== 'run') return s
    if (k === 3) {
      const t = now - writeStartedAt
      return { ...s, progress: Math.min(0.95, 1 - Math.exp(-t / WRITE_SCALE_MS)), detail: `${Math.round(t / 1000)} s` }
    }
    return { ...s, progress: Math.min(0.9, (now - stepStartedAt) / MIN_STEP_MS) }
  })
  await setPanel($, { ...p, steps, tick: p.tick + 1 })
}

// Runs one step: its work, and at least MIN_STEP_MS of bar.
async function step<T>($: EngineInterface, i: number, work: () => Promise<T>, detail: (v: T) => string): Promise<T> {
  running = i
  stepStartedAt = await $.clock.now()
  if (i === 3) writeStartedAt = stepStartedAt
  await patchStep($, i, { status: 'run', progress: 0.02 })
  const value = await work()
  const left = MIN_STEP_MS - ((await $.clock.now()) - stepStartedAt)
  if (left > 0 && i !== 3) await $.clock.sleep(left)
  await patchStep($, i, { status: 'done', progress: 1, detail: detail(value) })
  return value
}

type Gathered = { messages: SessionMessage[]; tools: number; files: string[]; skills: string[]; links: string[] }

const PATH_RE = /(?:~|\/Users)\/[^\s'"`<>()|;,*]+/g
const URL_RE = /https?:\/\/[^\s'"`<>()\]]+/g

async function gatherFiles($: EngineInterface, messages: SessionMessage[]) {
  const count = new Map<string, number>()
  const add = (raw: string, weight: number) => {
    let p = raw.replace(/[.:]+$/, '')
    if (p.startsWith('~/')) p = home + p.slice(1)
    if (p.includes('/.claude/projects/') || p.includes('/tool-results/') || p.startsWith('/private/tmp') || p.startsWith('/tmp')) return
    count.set(p, (count.get(p) ?? 0) + weight)
  }
  for (const m of messages) {
    for (const u of m.toolUses) {
      const fp = u.input.file_path ?? u.input.notebook_path ?? u.input.path
      if (typeof fp === 'string' && fp.startsWith('/')) add(fp, u.tool === 'Read' ? 2 : 3)
      if (u.tool === 'Bash' && typeof u.input.command === 'string') {
        for (const hit of u.input.command.match(PATH_RE) ?? []) add(hit, 1)
      }
    }
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
  const kept: string[] = []
  for (const p of ranked) {
    if (kept.length >= 30) break
    if (await $.fs.exists(p).catch(() => false)) kept.push(p)
  }
  return kept
}

function gatherSkills(messages: SessionMessage[]) {
  const skills = new Set<string>()
  const servers = new Set<string>()
  for (const m of messages) {
    for (const u of m.toolUses) {
      if (u.tool === 'Skill' && typeof u.input.skill === 'string') skills.add(`/${u.input.skill}`)
      if (u.tool.startsWith('mcp__')) servers.add(u.tool.split('__')[1] ?? u.tool)
    }
  }
  return [...skills, ...[...servers].map(s => `MCP ${s}`)]
}

function gatherLinks(messages: SessionMessage[]) {
  const links = new Set<string>()
  for (const m of messages) {
    for (const hit of m.text.match(URL_RE) ?? []) {
      const url = hit.replace(/[.,:;]+$/, '')
      if (!/localhost|127\.0\.0\.1|example\.com/.test(url)) links.add(url)
    }
  }
  return [...links].slice(-20)
}

function forkPrompt(cwd: string, g: Gathered) {
  const list = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- none found')
  return `Write a handoff prompt for a fresh Claude Code session that continues this work. Do not call any tool. Reply with the prompt only: no preamble, no code fence around it.

The reader starts with an empty context. It can open files on this machine, but it cannot see this chat. It loads CLAUDE.md, AGENTS.md and its memory index by itself, so do not repeat those.

Facts the handoff mod pulled from this transcript (check them against what you remember; drop what does not matter for the next step):
Working directory: ${cwd}
Files read or changed, most used first:
${list(g.files.map(tilde))}
Skills and MCP servers used:
${list(g.skills)}
Links in the chat:
${list(g.links)}

Use this shape in plain, short English. Leave out a section that has nothing in it.

# Handoff: <the goal, in a few words>

Continue work in \`${tilde(cwd)}\`. Goal: <what the user is working toward right now>.

## What the user asked for
Every request in this chat, in order, with the user's own key words. Mark each one: done, in progress, or not started.

## Where things stand
What is done and checked, the key decisions and why, and what was tested and what was not.

## Rules the user set
Standing constraints and preferences given in this chat: words to avoid, things never to do, approval steps, tone.

## Files to open first
- \`<path>\`: why it matters, in one line. Only files the next step needs, at most 15. Paths only; never copy file content.

## Skills and tools to use
- \`<skill, CLI or connector>\`: when to use it, and any trap found in this chat.

## Errors already solved
- <the error>: <the fix>. So the next session does not hit them again.

## Carried-over data
Only data that exists nowhere on disk: ids, URLs, numbers and decisions that live only in this chat. Verbatim.

## Next steps
1. The very next action, specific enough to start without asking a question.

Never write an API key, token or password; write where it lives instead (for example "in ~/.zshrc"). Keep it under 1,500 words.`
}

// Anything shaped like a secret is cut out before the handoff is saved or copied.
function redact(text: string) {
  return text
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g, '<secret removed>')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{20,}/g, '$1<secret removed>')
}

function slug(text: string) {
  const title = /^#\s*Handoff:\s*(.+)$/m.exec(text)?.[1] ?? 'session'
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'session'
  )
}

async function stamp($: EngineInterface) {
  const d = new Date(await $.clock.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

// Every run leaves a line here, so a failure is never silent again.
async function log($: EngineInterface, line: string) {
  try {
    const path = `${home}/.claude/handoffs/handoff.log`
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const at = new Date(await $.clock.now()).toISOString()
    const lines = old ? old.trimEnd().split('\n').slice(-400) : []
    lines.push(`${at} ${sid.slice(0, 8)} ${line}`)
    await $.fs.write(path, `${lines.join('\n')}\n`)
  } catch {
    // The log must never break a run.
  }
}

// A plain handoff built from the transcript alone, saved before the model step,
// so a failed or slow model call still leaves something to start from.
function draftText(cwd: string, g: Gathered) {
  const asks = g.messages
    .filter(m => m.role === 'user' && m.text.trim() && !m.text.trim().startsWith('<'))
    .slice(-25)
    .map(m => `- ${m.text.trim().replace(/\s+/g, ' ').slice(0, 300)}`)
  const list = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- none found')
  return `# Handoff draft (no model step)

Continue work in \`${tilde(cwd)}\`. This draft was saved before the model wrote the full handoff. Read the requests below, open the files, then ask the user what is next.

## What the user asked for (newest last)
${asks.join('\n') || '- none found'}

## Files to open first
${list(g.files.slice(0, 15).map(f => `\`${tilde(f)}\``))}

## Skills and tools used
${list(g.skills)}

## Links in the chat
${list(g.links)}
`
}

async function run($: EngineInterface) {
  if (busy) return
  busy = true
  let draftPath = ''
  const { context } = await $.session.usage()
  await setPanel($, { phase: 'working', tokens: context.tokens ?? 0, steps: freshSteps(), tick: 0, file: '', words: 0, error: '', note: '' })
  ticker?.cancel()
  ticker = $.clock.every(TICK_MS, () => {
    void tick($).catch(() => undefined)
  })
  try {
    const cwd = await $.session.cwd()
    const messages = await step(
      $,
      0,
      () => $.session.messages(),
      ms => `${plural(ms.length, 'message')}`,
    )
    const tools = messages.reduce((n, m) => n + m.toolUses.length, 0)
    const files = await step($, 1, () => gatherFiles($, messages), fs => plural(fs.length, 'file'))
    const found = await step(
      $,
      2,
      async () => ({ skills: gatherSkills(messages), links: gatherLinks(messages) }),
      f => `${plural(f.skills.length, 'skill')}, ${plural(f.links.length, 'link')}`,
    )
    const g: Gathered = { messages, tools, files, ...found }
    await $.process.run(['mkdir', '-p', `${home}/.claude/handoffs`])
    draftPath = `${home}/.claude/handoffs/${await stamp($)}-draft.md`
    const draft = redact(draftText(cwd, g))
    await $.fs.write(draftPath, draft)
    handoffText = draft
    handoffPath = draftPath
    await log($, `start ${short(context.tokens ?? 0)} ${messages.length} messages, draft ${tilde(draftPath)}`)
    const reply = await step(
      $,
      3,
      async () => {
        const r = await $.model.fork({ prompt: forkPrompt(cwd, g) })
        writeMs = (await $.clock.now()) - writeStartedAt
        return r
      },
      r => (r.isAnswered ? `${Math.round(writeMs / 1000)} s` : 'failed'),
    )
    if (!reply.isAnswered) {
      throw new Error(reply.reason === 'api-error' ? `the model call failed (${reply.status ?? '?'})` : `no handoff came back (${reply.reason})`)
    }
    const text = redact(reply.text.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, '$1'))
    const saved = await step(
      $,
      4,
      async () => {
        const dir = `${home}/.claude/handoffs`
        await $.process.run(['mkdir', '-p', dir])
        const path = `${dir}/${await stamp($)}-${slug(text)}.md`
        await $.fs.write(path, `${text}\n`)
        const back = String(await $.fs.read(path))
        if (back.trim() !== text) throw new Error('the saved file does not match')
        return path
      },
      p => tilde(p).split('/').pop() ?? '',
    )
    handoffText = text
    handoffPath = saved
    const p = await getPanel($)
    if (p) await setPanel($, { ...p, phase: 'ready', file: tilde(saved), words: text.split(/\s+/).length })
    if (sid) await $.store.set(`last:${sid}`, { path: saved })
    await log($, `ok ${tilde(saved)} ${text.split(/\s+/).length} words in ${Math.round(writeMs / 1000)} s`)
    // The full handoff replaces the draft.
    if (draftPath) await $.process.run(['rm', '-f', draftPath])
  } catch (err) {
    const p = await getPanel($)
    const steps = (p?.steps ?? freshSteps()).map((s, k) => (k === running && s.status === 'run' ? { ...s, status: 'fail' as const } : s))
    const why = String(err instanceof Error ? err.message : err).slice(0, 160)
    await setPanel($, {
      ...(p as Panel),
      steps,
      phase: 'failed',
      error: why,
      file: draftPath ? tilde(draftPath) : '',
      note: draftPath ? 'A basic draft is saved. Open it or copy it, or try again.' : '',
    })
    await log($, `failed at step ${running + 1}: ${why}`)
  } finally {
    ticker?.cancel()
    ticker = null
    running = -1
    busy = false
  }
}

async function note($: EngineInterface, text: string) {
  const p = await getPanel($)
  if (p) await setPanel($, { ...p, note: text })
}

async function copy($: EngineInterface) {
  if (!handoffText) return
  const r = await $.process.run(['pbcopy'], { stdin: handoffText })
  await note($, r.exitCode === 0 ? 'Copied. Paste it into a new chat with ⌘V.' : 'Copy failed. Use Open file instead.')
}

// The app's own link fills a new chat and you press Return.
async function startNew($: EngineInterface) {
  if (!handoffText) return
  const url = `claude://code/new?q=${encodeURIComponent(handoffText)}`
  const r = await $.process.run(['open', url])
  await note($, r.exitCode === 0 ? 'A new chat is filled in with the handoff. Press Return there to start it.' : 'The new chat did not open. Use Copy handoff prompt instead.')
}

async function checkOffer($: EngineInterface) {
  if (busy || off) return
  // Cache Clock (another mod) asks for a handoff by leaving this file.
  const request = `${home}/.claude/handoffs/.request-${sid}`
  if (sid && (await $.fs.exists(request).catch(() => false))) {
    await $.process.run(['rm', '-f', request])
    await log($, 'asked by Cache Clock')
    void run($).catch(() => undefined)
    return
  }
  const p = await getPanel($)
  if (p && p.phase !== 'offer') return
  // An offer asked for by Show stays until it is answered.
  if (forced && p) return
  forced = false
  if (hidden) {
    if (p) await setPanel($, null)
    return
  }
  const { context } = await $.session.usage()
  const tokens = context.tokens ?? 0
  // A compaction or /clear brings the count down: the offer starts over.
  if (tokens < OFFER_AT && snoozedTo > OFFER_AT) {
    snoozedTo = OFFER_AT
    if (sid) await $.store.set(`snooze:${sid}`, snoozedTo)
  }
  if (tokens >= snoozedTo) {
    if (!p || Math.abs(p.tokens - tokens) >= 1000) {
      await setPanel($, { phase: 'offer', tokens, steps: freshSteps(), tick: 0, file: '', words: 0, error: '', note: '' })
    }
  } else if (p) {
    await setPanel($, null)
  }
}

async function close($: EngineInterface) {
  const p = await getPanel($)
  if (p?.phase === 'offer') {
    // Hide on the offer: it stops popping up in every chat until Show or /refresh.
    await setHidden($, true)
    try {
      $.ui.toast('Refresh offer hidden. Type /refresh or open /mods to show it.')
    } catch {
      // The toast is only a hint.
    }
  } else if (p) {
    // Closing a finished handoff counts as an answer up to here, too.
    snoozedTo = Math.max(snoozedTo, p.tokens + SNOOZE)
    if (sid) await $.store.set(`snooze:${sid}`, snoozedTo)
  }
  await setPanel($, null)
}

function bar(progress: number, status: Step['status']) {
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * BAR)
  const color = status === 'fail' ? BAD : status === 'done' ? GOOD : ACCENT
  return { on: '━'.repeat(filled), off: '━'.repeat(BAR - filled), color }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    sid = await $.session.id()
    home = $.plugin.root.split('/.claude/')[0] ?? ''
    await poll($).catch(() => undefined)
    $.clock.every(3000, () => {
      void poll($).catch(() => undefined)
    })
    await $.command.register({ name: 'handoff', description: 'Write a handoff of this chat now, then copy it or start a new chat with it' })
    try {
      await $.command.register({ name: 'refresh', description: 'Show the Refresh panel now, to move this work to a fresh chat', immediate: true })
    } catch (err) {
      await log($, `could not add /refresh: ${String(err)}`)
    }
    await $.tool.register({
      name: 'refresh',
      description:
        'Open the Refresh panel above the prompt: it writes a handoff of this whole chat (what was asked, done, decided, files to open, next steps) and offers Copy and Start new chat. Use when the user asks to refresh, hand off, or move this work to a new chat. It starts when your turn ends.',
      inputSchema: { type: 'object', properties: {} },
    })
    const saved = await $.store.get(`snooze:${sid}`)
    if (typeof saved === 'number') snoozedTo = saved
    try {
      const last = (await $.store.get(`last:${sid}`)) as { path?: string } | undefined
      if (last?.path && (await $.fs.exists(last.path))) {
        handoffPath = last.path
        handoffText = String(await $.fs.read(last.path)).trim()
      }
    } catch {
      // No earlier handoff for this chat.
    }
    // A reload while the steps ran leaves a dead "working" band behind.
    const p = await getPanel($)
    if (p && p.phase === 'working') await setPanel($, null)
    $.clock.every(POLL_MS, () => {
      void checkOffer($).catch(() => undefined)
    })
    void checkOffer($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (off) return next(e)
    const result = await next(e)
    if (pending) {
      pending = false
      void run($).catch(() => undefined)
    } else {
      void checkOffer($).catch(() => undefined)
    }
    return result
  })

  on('command.run', { command: 'refresh' }, async $ => {
    if (off) return { text: 'Handoff (Refresh) is off. Turn it on with /mods.' }
    await setHidden($, false)
    await showOffer($)
    return { text: 'Refresh panel shown above the prompt. Press Hide on it, or use /mods, to hide it again.' }
  })

  on('command.run', { command: 'handoff' }, async $ => {
    if (off) return { text: 'Handoff (Refresh) is off. Turn it on with /mods.' }
    void run($).catch(() => undefined)
    return { text: 'Writing the handoff. Watch the panel above the prompt.' }
  })

  // One unfiltered hook: a typed tool matcher makes tsc recurse through the connector types.
  on('tool.call', async ($, e, next) => {
    if ((e.tool as string) !== 'mcp__handoff__refresh') return next(e)
    if (!off) pending = true
    const said = off
      ? 'Handoff (Refresh) is off. Tell the user to turn it on with /mods.'
      : 'The Refresh panel opens above the prompt when this turn ends. Tell the user in one short line, then end your turn.'
    return { result: said } as never
  }).catch(($, e, next) => next(e))

  // Presses go to these hooks, not to onPress: a closure lives one drawing, and the
  // band redraws ten times a second while the steps run.
  on('ui.press', { plugin: 'handoff', element: 'refresh' }, async ($, e) => {
    void run($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'retry' }, async ($, e) => {
    void run($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'copy' }, async ($, e) => {
    await copy($)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'start' }, async ($, e) => {
    void startNew($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'open' }, async ($, e) => {
    if (handoffPath) await $.process.run(['open', handoffPath])
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'close' }, async ($, e) => {
    await close($)
    return { element: e.element }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (off) return next(e)
    const p = await getPanel($)
    if (!p || e.props.hasSurvey) return next(e)
    // The offer waits out a running turn; the steps and the result do not.
    if (p.phase === 'offer' && e.props.isWorking) return next(e)
    const rest = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const noop = () => undefined

    if (p.phase === 'offer') {
      return (
        <Box flexDirection="column">
          {rest}
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Text>
              <Text color={ACCENT}>●</Text>
              <Text dimColor> Context at {short(p.tokens)}. Refresh moves this work to a new chat with a full handoff.</Text>
            </Text>
            <Box flexDirection="row" gap={1}>
              <Button key="refresh" label="Refresh" variant="primary" onPress={noop} />
              <Button key="close" label="Hide" role="dismiss" onPress={noop} />
            </Box>
          </Box>
        </Box>
      )
    }

    const title =
      p.phase === 'working'
        ? 'Refreshing: building your handoff'
        : p.phase === 'ready'
          ? `Handoff ready: ${p.words.toLocaleString('en-US')} words`
          : 'The handoff did not finish'
    const rows = p.steps.map((s, i) => {
      const icon =
        s.status === 'done' ? (
          <Text color={GOOD}>✓</Text>
        ) : s.status === 'fail' ? (
          <Text color={BAD}>✗</Text>
        ) : s.status === 'run' ? (
          <Text color={ACCENT}>{SPIN[p.tick % SPIN.length]}</Text>
        ) : (
          <Text dimColor>○</Text>
        )
      const b = bar(s.progress, s.status)
      return (
        <Box key={`row${i}`} flexDirection="row" gap={1}>
          <Box width={2}>{icon}</Box>
          <Box width={32}>
            <Text dimColor={s.status === 'wait'} wrap="truncate-end">
              {i + 1}. {s.label}
            </Text>
          </Box>
          <Text>
            <Text color={b.color}>{b.on}</Text>
            <Text dimColor>{b.off}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            {s.detail}
          </Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="column" gap={0} paddingY={0}>
          <Text bold color={p.phase === 'failed' ? BAD : p.phase === 'ready' ? GOOD : ACCENT}>
            {title}
          </Text>
          {rows}
          {p.phase === 'ready' ? (
            <Box flexDirection="column">
              <Text dimColor wrap="truncate-middle">
                Saved to {p.file}
              </Text>
              <Box flexDirection="row" gap={1}>
                <Button key="copy" label="Copy handoff prompt" variant="primary" onPress={noop} />
                <Button key="start" label="Start new chat with it" variant="secondary" onPress={noop} />
                <Button key="open" label="Open file" onPress={noop} />
                <Button key="close" label="Close" role="dismiss" onPress={noop} />
              </Box>
            </Box>
          ) : null}
          {p.phase === 'failed' ? (
            <Box flexDirection="column">
              <Text color={BAD}>{p.error}</Text>
              {p.file ? (
                <Text dimColor wrap="truncate-middle">
                  Draft saved to {p.file}
                </Text>
              ) : null}
              <Box flexDirection="row" gap={1}>
                <Button key="retry" label="Try again" variant="primary" onPress={noop} />
                {p.file ? <Button key="copy" label="Copy draft" onPress={noop} /> : null}
                {p.file ? <Button key="open" label="Open draft" onPress={noop} /> : null}
                <Button key="close" label="Close" role="dismiss" onPress={noop} />
              </Box>
            </Box>
          ) : null}
          {p.note ? <Text dimColor>{p.note}</Text> : null}
        </Box>
      </Box>
    )
  })
}
