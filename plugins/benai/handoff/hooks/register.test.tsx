import { expect, mock, test } from 'claude-code/testing'

const HANDOFF = '# Handoff: Build the refresh mod\n\nContinue work in `~/vault`. Goal: finish it.\n\n## Next steps\n1. Test it.'

for (const surface of ['desktop', 'terminal'] as const) {
  test(`offer at 250k, steps, then copy and start (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    let tokens = 120_000
    const files: Record<string, string> = {}
    const store: Record<string, unknown> = {}
    const runs: { argv: readonly string[]; stdin?: string }[] = []
    let forkPrompt = ''

    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    on('tool.register', async () => ({ value: { tool: 'mcp__handoff__refresh' } }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.cwd', async () => ({ value: '/Users/test/vault' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens, window: 1_000_000 } } }) as never)
    on('session.messages', async () =>
      ({
        value: [
          { role: 'user', text: 'Build a refresh mod', toolUses: [] },
          {
            role: 'assistant',
            text: 'Published https://claude.ai/artifact/abc',
            toolUses: [
              { tool_use_id: 't1', tool: 'Read', input: { file_path: '/Users/test/vault/a.md' } },
              { tool_use_id: 't2', tool: 'Skill', input: { skill: 'plugin-authoring' } },
              { tool_use_id: 't3', tool: 'Bash', input: { command: 'cat ~/notes/b.md /tmp/x' } },
            ],
          },
        ],
      }) as never,
    )
    on('model.fork', async ($, e) => {
      forkPrompt = (e as { prompt: string }).prompt
      return { value: { isAnswered: true, text: `${HANDOFF}\nkey sk-abcdefghijklmnopqrstuvwxyz`, usage: {} } } as never
    })
    on('fs.exists', async ($, e) => {
      const p = (e as { path: string }).path
      return { value: p.endsWith('.md') && !p.includes('/tmp/') ? true : p in files } as never
    })
    on('fs.write', async ($, e) => {
      const { path, text } = e as { path: string; text: string }
      files[path] = text
      return { value: undefined } as never
    })
    on('fs.read', async ($, e) => ({ value: files[(e as { path: string }).path] ?? '' }) as never)
    on('process.run', async ($, e) => {
      const { argv, init } = e as { argv: readonly string[]; init?: { stdin?: string } }
      runs.push({ argv, stdin: init?.stdin })
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    })
    on('store.get', async ($, e) => ({ value: store[(e as { key: string }).key] }) as never)
    on('store.set', async ($, e) => {
      const { key, value } = e as { key: string; value: unknown }
      store[key] = value
      return { value: undefined } as never
    })
    on('turn.complete', async () => ({ text: '' }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })

    const props = { isWorking: false, hasSurvey: false } as never
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)

    let v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'refresh' }), 'no offer below 250k').toBeUndefined()

    tokens = 262_000
    await $.turn.complete({ answer: '' } as never)
    // checkOffer runs after the turn's answer, unawaited.
    await clock.settle()
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'refresh' }), 'offer at 262k').toBeDefined()

    await v.press({ key: 'refresh' })
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'row0' }), 'working: the step rows show').toBeDefined()
    // The run goes on after the press; give it its awaited steps.
    await clock.advance(10_000)
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'copy' }), 'ready: copy button').toBeDefined()
    expect(await v.find({ key: 'start' }), 'ready: start button').toBeDefined()

    const saved = Object.entries(files).find(([k]) => k.includes('/.claude/handoffs/') && k.endsWith('.md') && !k.endsWith('-draft.md'))
    const logged = Object.entries(files).find(([k]) => k.endsWith('/handoff.log'))
    expect(logged?.[1] ?? '', 'the run is logged').toContain(' ok ')
    expect(Object.keys(files).some(k => k.endsWith('-draft.md')), 'a draft was saved before the model step').toBe(true)
    expect(saved?.[0] ?? '', 'saved under ~/.claude/handoffs with the title slug').toContain('build-the-refresh-mod.md')
    expect(saved?.[1] ?? '', 'secret removed').not.toContain('sk-abcdefghij')
    expect(forkPrompt, 'fork prompt lists the read file').toContain('/Users/test/vault/a.md')
    expect(forkPrompt, 'fork prompt lists the skill').toContain('/plugin-authoring')
    expect(forkPrompt, 'fork prompt lists the link').toContain('https://claude.ai/artifact/abc')
    expect(forkPrompt, 'tmp paths dropped').not.toContain('/tmp/x')

    await v.press({ key: 'copy' })
    const copied = runs.find(r => r.argv[0] === 'pbcopy')
    expect(copied?.stdin ?? '', 'copy sends the handoff to pbcopy').toContain('# Handoff: Build the refresh mod')

    await v.press({ key: 'start' })
    await clock.advance(2_000)
    const opened = runs.find(r => r.argv[0] === 'open' && (r.argv[1] ?? '').startsWith('claude://code/new?q='))
    expect(decodeURIComponent(opened?.argv[1] ?? ''), 'start opens the app link with the handoff').toContain('# Handoff: Build the refresh mod')

    await v.press({ key: 'close' })
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'copy' }), 'closed').toBeUndefined()
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`Cache Clock request runs it; a failed model step keeps the draft and logs (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    // Cache Clock left a request file for this chat.
    let requested = true
    const files: Record<string, string> = {}
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    on('tool.register', async () => ({ value: { tool: 'mcp__handoff__refresh' } }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.cwd', async () => ({ value: '/Users/test/vault' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens: 90_000, window: 1_000_000 } } }) as never)
    on('session.messages', async () => ({ value: [{ role: 'user', text: 'Write the newsletter', toolUses: [] }] }) as never)
    on('model.fork', async () => ({ value: { isAnswered: false, reason: 'api-error', status: 529 } }) as never)
    on('fs.exists', async ($, e) => {
      const p = (e as { path: string }).path
      return { value: p.endsWith('/.request-sid') ? requested : p in files } as never
    })
    on('fs.write', async ($, e) => {
      const { path, text } = e as { path: string; text: string }
      files[path] = text
      return { value: undefined } as never
    })
    on('fs.read', async ($, e) => ({ value: files[(e as { path: string }).path] ?? '' }) as never)
    on('process.run', async ($, e) => {
      const { argv } = e as { argv: readonly string[] }
      if (argv[0] === 'rm' && argv.some(a => a.endsWith('/.request-sid'))) requested = false
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    })
    on('store.get', async () => ({ value: undefined }) as never)
    on('store.set', async () => ({ value: undefined }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    // The plugin's root decides the home folder.
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await clock.advance(20_000)
    const props = { isWorking: false, hasSurvey: false } as never
    const v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props })
    const log = Object.entries(files).find(([k]) => k.endsWith('/handoff.log'))?.[1] ?? ''
    expect(log, 'the request is logged').toContain('asked by Cache Clock')
    expect(log, 'the failure is logged').toContain('failed at step 4')
    expect(requested, 'the request file is removed').toBe(false)
    expect(await v.find({ key: 'retry' }), 'failed: try again').toBeDefined()
    expect(await v.find({ key: 'open' }), 'failed: the draft can be opened').toBeDefined()
    const draft = Object.entries(files).find(([k]) => k.endsWith('-draft.md'))?.[1] ?? ''
    expect(draft, 'the draft holds the request').toContain('Write the newsletter')
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`draws nothing of its own when switched off in /mods (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    let switches = ''
    const isSwitches = (e: unknown) => (e as { path: string }).path.endsWith('/.claude/mods/switches.json')
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    on('tool.register', async () => ({ value: { tool: 'mcp__handoff__refresh' } }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens: 260_000, window: 1_000_000 } } }) as never)
    on('fs.exists', async ($, e) => ({ value: isSwitches(e) && switches !== '' }) as never)
    on('fs.read', async ($, e) => ({ value: isSwitches(e) ? switches : '' }) as never)
    on('fs.write', async () => ({ value: undefined }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
    on('store.get', async () => ({ value: undefined }) as never)
    on('store.set', async () => ({ value: undefined }) as never)
    on('turn.complete', async () => ({ text: '' }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    const props = { isWorking: false, hasSurvey: false } as never
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await clock.settle()
    let v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'refresh' }), 'offer shows while on').toBeDefined()

    switches = JSON.stringify({ handoff: false })
    await clock.advance(3100)
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'refresh' }), 'no band when off').toBeUndefined()
    expect(await v.find({ text: 'REST' }), 'other bands still draw').toBeDefined()
    // Typed loosely: tsc runs out of memory resolving $.tool.call's overloads over every tool.
    const tools = $.tool as unknown as { call: (input: Record<string, unknown>) => Promise<unknown> }
    const said = await tools.call({ tool: 'mcp__handoff__refresh' })
    expect(JSON.stringify(said), 'the tool says it is off').toContain('/mods')
  })
}

/** The `on` a test body is handed. */
type On = Parameters<NonNullable<Parameters<typeof test>[2]>>[1]

const SW = '/.claude/mods/switches.json'
const OPEN = '/.claude/mods/.open-handoff-sid'

/** Mocks every $ call the offer makes; `files` stands in for the disk, keyed by path end. */
function rig(on: On, files: Record<string, string>, tokens: { value: number }) {
  const toasts: string[] = []
  const keyOf = (path: string) => Object.keys(files).find(k => path.endsWith(k))
  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async () => ({ value: { tool: 'mcp__handoff__refresh' } }) as never)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.id', async () => ({ value: 'sid' }) as never)
  on('session.usage', async () => ({ value: { context: { tokens: tokens.value, window: 1_000_000 } } }) as never)
  on('fs.exists', async ($, e) => ({ value: keyOf((e as { path: string }).path) !== undefined }) as never)
  on('fs.read', async ($, e) => ({ value: files[keyOf((e as { path: string }).path) ?? ''] ?? '' }) as never)
  on('fs.write', async ($, e) => {
    const { path, text } = e as { path: string; text: string }
    files[path.endsWith(SW) ? SW : path] = text
    return { value: undefined } as never
  })
  on('process.run', async ($, e) => {
    const { argv } = e as { argv: readonly string[] }
    const hit = argv[0] === 'rm' ? keyOf(argv[argv.length - 1] ?? '') : undefined
    if (hit) delete files[hit]
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('store.get', async () => ({ value: undefined }) as never)
  on('store.set', async () => ({ value: undefined }) as never)
  on('ui.toast', async ($, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('turn.complete', async () => ({ text: '' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>REST</Text>
  })
  return { clock, toasts }
}

const offerProps = { isWorking: false, hasSurvey: false } as never
const begin = { source: 'startup', cwd: '/Users/test/vault', isInteractive: true } as const

for (const surface of ['desktop', 'terminal'] as const) {
  test(`Hide on the offer writes the shared flag and it stays away (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const tokens = { value: 262_000 }
    const { clock, toasts } = rig(on, files, tokens)
    await $.session.start({ ...begin, surface } as never)
    await clock.settle()
    let v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props: offerProps })
    expect(await v.find({ key: 'refresh' }), 'offer at 262k').toBeDefined()

    await v.press({ key: 'close' })
    expect(JSON.parse(files[SW] ?? '{}'), 'Hide writes the shared flag').toEqual({ 'handoff:hidden': true })
    expect(toasts.join(' '), 'the toast names the way back').toContain('/refresh')
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props: offerProps })
    expect(await v.find({ key: 'refresh' }), 'offer gone').toBeUndefined()

    // More tokens and more turns: the offer does not pop up while hidden.
    tokens.value = 420_000
    await $.turn.complete({ answer: '' } as never)
    await clock.advance(10_000)
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props: offerProps })
    expect(await v.find({ key: 'refresh' }), 'still hidden').toBeUndefined()
    expect(await v.find({ text: 'REST' }), 'other bands still draw').toBeDefined()
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`clearing the flag brings the offer back; Show and /refresh open it at any size (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = { [SW]: JSON.stringify({ 'handoff:hidden': true }) }
    const tokens = { value: 262_000 }
    const { clock } = rig(on, files, tokens)
    await $.session.start({ ...begin, surface } as never)
    await clock.settle()
    let v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props: offerProps })
    expect(await v.find({ key: 'refresh' }), 'no offer while hidden').toBeUndefined()

    // /mods clears the flag: the next check draws the offer again.
    files[SW] = '{}'
    await clock.advance(5100)
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props: offerProps })
    expect(await v.find({ key: 'refresh' }), 'offer back').toBeDefined()

    // Hide it, then a small chat: the Show request still brings it up now.
    await v.press({ key: 'close' })
    tokens.value = 40_000
    files[SW] = '{}'
    files[OPEN] = ''
    await clock.advance(3100)
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props: offerProps })
    expect(await v.find({ key: 'refresh' }), 'Show opens it at 40k').toBeDefined()
    expect(files[OPEN], 'the request file is used up').toBeUndefined()
    // It stays through the 5 s check, though the count is under 250k.
    await clock.advance(10_000)
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props: offerProps })
    expect(await v.find({ key: 'refresh' }), 'a shown offer stays').toBeDefined()

    // Hide, then /refresh clears the flag and shows it again.
    await v.press({ key: 'close' })
    const said = JSON.stringify(await $.command.run({ command: 'refresh', args: '' } as never))
    expect(said, '/refresh reply').toContain('Refresh panel shown')
    expect(JSON.parse(files[SW] ?? '{}'), '/refresh clears the flag').toEqual({})
    v = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props: offerProps })
    expect(await v.find({ key: 'refresh' }), '/refresh shows the panel').toBeDefined()
  })
}
