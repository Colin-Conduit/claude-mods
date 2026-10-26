import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const OLD_CLAUDE = '# Global rules\n\n## Tool preference order\n\n1. Printing Press CLIs first.\n\n## Imported skills\n\n@~/dev/browser-harness/SKILL.md\n'
const RULE = 'Never use em dashes in newsletter copy.'

type World = {
  files: Record<string, string>
  store: Record<string, unknown>
  asked: string[]
  classified: string[]
  drafts: number
  /** What the folder dialog answers: a label, a typed path, or null to dismiss it. */
  answer: string | null
  /** What a CLAUDE.md read returns before anything is written, under whatever home the mod uses. */
  claudeSeed?: string
  /** What switches.json holds for the /mods switchboard, under whatever home the mod uses. */
  switches?: string
}

// Every $ call the mod makes, answered here, so no real file is ever read or written.
function mockAll(on: On, w: World) {
  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.messages', async () =>
    ({
      value: [
        { role: 'user', text: 'Write the newsletter intro', toolUses: [] },
        { role: 'assistant', text: 'Here is the intro — short and punchy — for this week.', toolUses: [] },
      ],
    }) as never,
  )
  on('model.classify', async ($, e) => {
    const { text } = e as { text: string }
    w.classified.push(text)
    return { value: /em dash/i.test(text) ? 'correction' : 'other' } as never
  })
  on('model.complete', async () => {
    w.drafts += 1
    return { value: { isAnswered: true, text: `{"rule": "${RULE}", "slug": "no-em-dashes-in-newsletters"}`, usage: {} } } as never
  })
  // $.ui.ask is a tool.call of AskUserQuestion: answer it as the dialog would, with w.answer.
  // Typed loosely: the AskUserQuestion matcher's full type is too deep for tsc.
  const onLoose = on as unknown as (event: string, match: object, hook: (_$: unknown, e: { questions: { question: string }[] }) => Promise<unknown>) => void
  onLoose('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const questions = e.questions
    const q = questions[0]?.question ?? ''
    w.asked.push(q)
    if (w.answer === null) throw new Error('dismissed')
    return { result: { questions, answers: { [q]: w.answer } } }
  })
  const seed = (p: string) => {
    if (w.claudeSeed !== undefined && p.endsWith('/.claude/CLAUDE.md') && !(p in w.files)) w.files[p] = w.claudeSeed
    if (w.switches !== undefined && p.endsWith('/.claude/mods/switches.json')) w.files[p] = w.switches
  }
  on('fs.exists', async ($, e) => {
    const p = (e as { path: string }).path
    seed(p)
    return { value: p in w.files } as never
  })
  on('fs.read', async ($, e) => {
    const p = (e as { path: string }).path
    seed(p)
    if (!(p in w.files)) throw new Error(`ENOENT ${p}`)
    return { value: w.files[p] } as never
  })
  on('fs.write', async ($, e) => {
    const { path, text } = e as { path: string; text: string }
    w.files[path] = text
    return { value: undefined } as never
  })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('store.get', async ($, e) => ({ value: w.store[(e as { key: string }).key] }) as never)
  on('store.set', async ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    w.store[key] = value
    return { value: undefined } as never
  })
  on('store.delete', async ($, e) => {
    delete w.store[(e as { key: string }).key]
    return { value: undefined } as never
  })
  on('prompt.submit', async ($, e) => ({ text: e.text }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>REST</Text>
  })
}

// Submits a correction and ends the turn, so the offer band is up.
async function offer($: Parameters<TestBody>[0], clock: { settle: () => Promise<unknown> }, text: string, turnId: string) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
  await clock.settle()
  await $.turn.complete({ answer: 'Fixed.', durationMs: 10, isAborted: false, turnId, reason: 'answer' } as never)
  await clock.settle()
}

const world = (): World => ({ files: {}, store: {}, asked: [], classified: [], drafts: 0, answer: '~/Documents/rules' })
const props = { isWorking: false, hasSurvey: false } as never

for (const surface of ['desktop', 'terminal'] as const) {
  test(`a correction shows the band, Save everywhere keeps CLAUDE.md content (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const w = world()
    mockAll(on, w)
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 15, 12) })
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)

    await $.prompt.submit({ text: "No, I said never use em dashes. Don't do that again.", wait: false, origin: { kind: 'composer' } } as never)
    await clock.settle()
    expect(w.drafts, 'the draft ran after the classifier said correction').toBe(1)

    // While the turn runs, nothing shows.
    let v = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props: { isWorking: true, hasSurvey: false } as never })
    expect(await v.find({ key: 'everywhere' }), 'hidden while working').toBeUndefined()

    await $.turn.complete({ answer: 'Fixed.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.settle()
    v = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'everywhere' }), 'Save everywhere button').toBeDefined()
    expect(await v.find({ key: 'vault' }), 'Save to vault button').toBeDefined()
    expect(await v.find({ key: 'skip' }), 'Skip button').toBeDefined()
    expect(await v.find({ text: /Save this as a rule\?/ }), 'the question').toBeDefined()
    expect(await v.find({ text: /Never use em dashes in newsletter copy\./ }), 'the drafted rule').toBeDefined()

    // The mocked CLAUDE.md already holds other content.
    w.claudeSeed = OLD_CLAUDE
    await v.press({ key: 'everywhere' })
    const claudePath = Object.keys(w.files).find(k => k.endsWith('/.claude/CLAUDE.md')) ?? ''
    const after = w.files[claudePath] ?? ''
    expect(after.startsWith(OLD_CLAUDE.trimEnd()), 'old content kept in place').toBe(true)
    expect(after, 'heading added').toContain('\n## Rules from corrections\n\n- Never use em dashes in newsletter copy. (added 2026-10-15)\n')
    expect(after.endsWith('(added 2026-10-15)\n'), 'rule is the last line').toBe(true)

    v = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'open' }), 'saved line with Open').toBeDefined()
    expect(await v.find({ text: /~\/\.claude\/CLAUDE\.md/ }), 'short path shown').toBeDefined()
    await clock.advance(8100)
    v = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'open' }), 'gone after 8 seconds').toBeUndefined()
  })

  test(`rules_folder unset: Save to vault asks once, remembers, and writes the rule file (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const w = world()
    mockAll(on, w)
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 15, 12) })
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)

    await offer($, clock, 'Stop using em dashes in the newsletter, avoid them.', 't1')
    const v = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    await v.press({ key: 'vault' })

    expect(w.asked.length, 'asked once').toBe(1)
    expect(w.asked[0], 'asked for a folder').toBe('Which folder should rule notes go in?')
    expect(w.store.folder, 'folder kept in the store').toBe('~/Documents/rules')
    const hit = Object.entries(w.files).find(([k]) => k.endsWith('/Documents/rules/no-em-dashes-in-newsletters.md'))
    expect(hit, 'rule file in the chosen folder').toBeDefined()
    expect(hit?.[0].includes('~'), 'the ~ was expanded').toBe(false)
    const body = hit?.[1] ?? ''
    expect(body.startsWith('---\ntype: rule\nstatus: active\ndate: 2026-10-15\nsource: correction in a Claude Code chat\ntags: [rule]\n---\n'), 'frontmatter').toBe(true)
    expect(body).toContain('# Never use em dashes in newsletter copy\n')
    expect(body).toContain(`\n${RULE}\n`)
    expect(body).toContain('Why: "Stop using em dashes in the newsletter, avoid them."')
    expect(body, 'no em dash in the file').not.toContain('—')
    expect(Object.keys(w.files).some(k => k.endsWith('/.claude/CLAUDE.md')), 'CLAUDE.md untouched').toBe(false)

    // A second save of the same slug gets -2, and the folder is not asked again.
    await offer($, clock, 'No, never use em dashes there.', 't2')
    const v2 = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    await v2.press({ key: 'vault' })
    expect(w.asked.length, 'folder remembered').toBe(1)
    expect(Object.keys(w.files).some(k => k.endsWith('/Documents/rules/no-em-dashes-in-newsletters-2.md')), '-2 suffix').toBe(true)

    // /reflect folder forgets it, so the next save asks again, here for a typed path.
    const said = JSON.stringify(await $.command.run({ command: 'reflect', args: 'folder' } as never))
    expect(said, 'says it forgot').toContain('Remembered folder cleared')
    expect(w.store.folder, 'store cleared').toBeUndefined()
    w.answer = '/Users/test/notes/rules/'
    await offer($, clock, 'No, never use em dashes there.', 't3')
    const v3 = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    await v3.press({ key: 'vault' })
    expect(w.asked.length, 'asked again after /reflect folder').toBe(2)
    expect(w.store.folder, 'typed path kept').toBe('/Users/test/notes/rules/')
    expect('/Users/test/notes/rules/no-em-dashes-in-newsletters.md' in w.files, 'written to the typed path').toBe(true)
  })

  test(`rules_folder unset: cancelling the folder dialog saves nothing (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const w = world()
    mockAll(on, w)
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 15, 12) })
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)

    for (const answer of [null, 'Cancel'] as const) {
      w.answer = answer
      await offer($, clock, 'No, I said never use em dashes.', `t-${String(answer)}`)
      const v = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
      await v.press({ key: 'vault' })
      expect(Object.keys(w.files).some(k => k.endsWith('.md')), `nothing written (${String(answer)})`).toBe(false)
      expect(w.store.folder, `nothing remembered (${String(answer)})`).toBeUndefined()
      const after = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
      expect(await after.find({ text: /No folder picked\. Nothing saved\./ }), `says nothing was saved (${String(answer)})`).toBeDefined()
    }
  })

  test(`rules_folder set: Save to vault writes there without asking (${surface})`, { timeoutMs: 30000, options: { rules_folder: '/Users/test/my-rules' } }, async ($, on) => {
    const w = world()
    mockAll(on, w)
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 15, 12) })
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)

    await offer($, clock, 'Stop using em dashes in the newsletter, avoid them.', 't1')
    const v = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    await v.press({ key: 'vault' })
    expect(w.asked.length, 'never asked').toBe(0)
    expect(w.store.folder, 'nothing remembered').toBeUndefined()
    expect('/Users/test/my-rules/no-em-dashes-in-newsletters.md' in w.files, 'written to rules_folder').toBe(true)
    const saved = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    expect(await saved.find({ text: /\/Users\/test\/my-rules\/no-em-dashes-in-newsletters\.md/ }), 'saved line names the file').toBeDefined()

    // /reflect folder says the setting still applies.
    const said = JSON.stringify(await $.command.run({ command: 'reflect', args: 'folder' } as never))
    expect(said, 'names the setting').toContain('/Users/test/my-rules')
  })

  test(`a normal prompt shows no band (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const w = world()
    mockAll(on, w)
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 15, 12) })
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)

    await $.prompt.submit({ text: 'thanks, now do the next one', wait: false, origin: { kind: 'composer' } } as never)
    await clock.settle()
    await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.settle()
    expect(w.classified.length, 'the cheap filter stopped it before the model').toBe(0)
    expect(w.drafts).toBe(0)
    const v = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'everywhere' }), 'no band').toBeUndefined()
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`draws nothing of its own when switched off in /mods (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const w = world()
    mockAll(on, w)
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 15, 12) })
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.prompt.submit({ text: "No, I said never use em dashes. Don't do that again.", wait: false, origin: { kind: 'composer' } } as never)
    await clock.settle()
    await $.turn.complete({ answer: 'Fixed.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.settle()
    let v = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'everywhere' }), 'band shows while on').toBeDefined()

    w.switches = JSON.stringify({ reflect: false })
    await clock.advance(3100)
    v = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'everywhere' }), 'no band when off').toBeUndefined()
    expect(await v.find({ text: 'REST' }), 'other bands still show').toBeDefined()

    await $.prompt.submit({ text: 'No, never use em dashes there.', wait: false, origin: { kind: 'composer' } } as never)
    await clock.settle()
    expect(w.drafts, 'no new draft while off').toBe(1)
  })
}
