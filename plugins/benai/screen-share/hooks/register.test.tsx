import { expect, mock, test } from 'claude-code/testing'

import { BAR, FADE, mask, redact } from './mask'

const PRIVATE = 'Mail jane.doe@acme.com or call +44 7700 900123. The deal is $4,250.00 for 2026, we used 182k tokens.'
// The same line with each private span drawn as a bar of its own length.
const BARRED = `Mail ${BAR.repeat(17)} or call ${BAR.repeat(3)} ${BAR.repeat(4)} ${BAR.repeat(6)}. The deal is ${BAR.repeat(9)} for 2026, we used 182k tokens.`
const NAMED = 'From: Jane Doe <jane@x.com>'

for (const surface of ['desktop', 'terminal'] as const) {
  test(`screen-share hides private data on screen only while on (${surface})`, async ($, on) => {
    const store: Record<string, unknown> = {}
    const statuses: (string | undefined)[] = []
    const seen: Record<string, unknown> = {}

    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('session.id', async () => ({ value: 'sid' }) as never)
    let registered: { immediate?: boolean } = {}
    on('command.register', async ($, e) => {
      registered = e as { immediate?: boolean }
      return { value: { command: 'screen-share' } } as never
    })
    on('store.get', async ($, e) => ({ value: store[(e as { key: string }).key] }) as never)
    on('store.set', async ($, e) => {
      const { key, value } = e as { key: string; value: unknown }
      store[key] = value
      return { value: undefined } as never
    })
    on('ui.status', async ($, e) => {
      statuses.push((e as { text: string | undefined }).text)
      return { value: undefined } as never
    })
    const clock = mock.clock(on, { now: 0 })
    const invalidated: string[] = []
    on('ui.invalidate', async ($, e) => {
      invalidated.push(String((e as { event: string }).event))
      return { value: undefined } as never
    })

    // Beneath the mod these stand for the engine's own components: they record
    // the props that reached them and draw the text.
    on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
      seen.assistant = e.props.text
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })
    on('ui.render', { component: 'UserMessage' }, async ($, e) => {
      seen.user = e.props.text
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })
    on('ui.render', { component: 'ToolResult' }, async ($, e) => {
      seen.result = e.props.output
      const { Text } = $.ui.resolve(e)
      return <Text>result</Text>
    })
    on('ui.render', { component: 'ToolUse' }, async ($, e) => {
      seen.useInput = e.props.input
      seen.useOutput = e.props.output
      const { Text } = $.ui.resolve(e)
      return <Text>row</Text>
    })
    on('ui.render', { component: 'CommandOutput' }, async ($, e) => {
      seen.command = e.props.text
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })

    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await clock.settle()
    expect(registered.immediate, '/screen-share runs at once, also mid-turn').toBe(true)

    const bash = { stdout: PRIVATE, stderr: '', interrupted: false }
    const drawAll = async () => {
      await $.ui.mount({ plugin: 'screen-share', surface, component: 'AssistantMessage', props: { text: PRIVATE, isFirstOfReply: true } as never })
      await $.ui.mount({ plugin: 'screen-share', surface, component: 'UserMessage', props: { text: PRIVATE, origin: { kind: 'composer' }, isExpanded: true } as never })
      await $.ui.mount({ plugin: 'screen-share', surface, component: 'ToolResult', props: { tool_use_id: 't1', tool: 'Bash', output: bash, isErrored: false } as never })
      await $.ui.mount({
        plugin: 'screen-share',
        surface,
        component: 'ToolUse',
        props: { tool_use_id: 't1', tool: 'Bash', input: { command: `echo "${PRIVATE}"` }, output: bash, isRunning: false, isErrored: false, isInterrupted: false } as never,
      })
      await $.ui.mount({ plugin: 'screen-share', surface, component: 'CommandOutput', props: { command: 'cost', args: '', text: PRIVATE, isErrored: false } as never })
    }
    const band = { isWorking: false, hasSurvey: false, maxRows: 20, bodyColumns: 100 } as never

    // Off: every prop reaches the screen as it came.
    await drawAll()
    expect(seen.assistant, 'off: assistant text unchanged').toBe(PRIVATE)
    expect(seen.user, 'off: user text unchanged').toBe(PRIVATE)
    expect(seen.result, 'off: result unchanged').toEqual(bash)
    expect(seen.command, 'off: command output unchanged').toBe(PRIVATE)
    let v = await $.ui.mount({ plugin: 'screen-share', surface, component: 'AbovePrompt', props: band })
    expect(await v.find({ key: 'off' }), 'off: no band').toBeUndefined()

    // Turn it on: every row is asked to draw again at once, no 3 s poll.
    const before = invalidated.length
    const res = await $.command.run({ command: 'screen-share', args: '' } as never)
    expect(String((res as { text?: string }).text), 'command says on').toContain('Screen-share on')
    expect(statuses.at(-1), 'status line on').toBe('Screen-share on')
    expect(store['on:sid'], 'mode remembered for the chat').toBe(true)
    expect(invalidated.slice(before), 'redraw asked at once').toContain('ui.render')

    // First frame: the light fade-in bar.
    await drawAll()
    expect(String(seen.assistant), 'fade frame').toBe(BARRED.replaceAll(BAR, FADE))

    // 150 ms on: the full bars, and one more redraw.
    const mid = invalidated.length
    await clock.advance(200)
    expect(invalidated.length, 'fade redraws').toBeGreaterThan(mid)
    await drawAll()
    const shown = String(seen.assistant)
    expect(shown, 'email, phone and amount become bars of equal length').toBe(BARRED)
    expect(shown.length, 'line keeps its length').toBe(PRIVATE.length)
    expect(shown, 'email hidden').not.toContain('jane.doe@acme.com')
    expect(shown, 'phone hidden').not.toContain('7700 900123')
    expect(shown, 'amount hidden').not.toContain('4,250')
    expect(shown, 'year stays').toContain('2026')
    expect(shown, 'token count stays').toContain('182k tokens')

    // A name next to an email is hidden too.
    await $.ui.mount({ plugin: 'screen-share', surface, component: 'AssistantMessage', props: { text: NAMED, isFirstOfReply: true } as never })
    expect(seen.assistant, 'name hidden').toBe(`From: ${BAR.repeat(4)} ${BAR.repeat(3)} <${BAR.repeat(10)}>`)

    const out = seen.result as { stdout: string; stderr: string; interrupted: boolean }
    expect(out.stdout, 'tool result masked').toBe(BARRED)
    expect(out.stdout).toContain('2026')
    expect(out.stdout).toContain('182k tokens')
    expect(out.interrupted, 'result keeps its shape').toBe(false)
    expect(String(seen.user)).toBe(BARRED)
    expect(String(seen.command)).toBe(BARRED)
    expect((seen.useInput as { command: string }).command, 'tool input masked').not.toContain('jane.doe@acme.com')
    expect((seen.useOutput as { stdout: string }).stdout).toBe(mask(PRIVATE))
    expect(mask(PRIVATE), 'bars by default').toBe(BARRED)

    v = await $.ui.mount({ plugin: 'screen-share', surface, component: 'AbovePrompt', props: band })
    expect(await v.find({ key: 'off' }), 'band shows Turn off').toBeDefined()
    expect(await v.find({ type: 'Text', text: /Screen-share mode/ }), 'band line').toBeDefined()
    expect(await v.find({ type: 'Text', text: /REST/ }), 'other bands still show').toBeDefined()

    // Turn off from the band: the real text draws again, at once.
    const atOff = invalidated.length
    await v.press({ key: 'off' })
    expect(statuses.at(-1), 'status cleared').toBeUndefined()
    expect(store['on:sid']).toBe(false)
    expect(invalidated.slice(atOff), 'redraw asked at once when off').toContain('ui.render')
    await drawAll()
    expect(seen.assistant, 'off again: real text').toBe(PRIVATE)
    expect(seen.user, 'off again: real user text').toBe(PRIVATE)
    expect(seen.result).toEqual(bash)
    v = await $.ui.mount({ plugin: 'screen-share', surface, component: 'AbovePrompt', props: band })
    expect(await v.find({ key: 'off' }), 'band gone').toBeUndefined()
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`draws nothing of its own when switched off in /mods (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    let switches = ''
    const statuses: (string | undefined)[] = []
    const seen: Record<string, unknown> = {}
    const isSwitches = (e: unknown) => (e as { path: string }).path.endsWith('/.claude/mods/switches.json')
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('command.register', async () => ({ value: { command: 'screen-share' } }) as never)
    on('store.get', async () => ({ value: true }) as never)
    on('store.set', async () => ({ value: undefined }) as never)
    on('ui.status', async ($, e) => {
      statuses.push((e as { text: string | undefined }).text)
      return { value: undefined } as never
    })
    const clock = mock.clock(on, { now: 0 })
    on('fs.exists', async ($, e) => ({ value: isSwitches(e) && switches !== '' }) as never)
    on('fs.read', async ($, e) => ({ value: isSwitches(e) ? switches : '' }) as never)
    on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
      seen.assistant = e.props.text
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    const band = { isWorking: false, hasSurvey: false, maxRows: 20, bodyColumns: 100 } as never

    // The chat had the mode on: a reload brings it back.
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await clock.settle()
    let v = await $.ui.mount({ plugin: 'screen-share', surface, component: 'AbovePrompt', props: band })
    expect(await v.find({ key: 'off' }), 'band shows while on').toBeDefined()

    switches = JSON.stringify({ 'screen-share': false })
    await clock.advance(3100)
    v = await $.ui.mount({ plugin: 'screen-share', surface, component: 'AbovePrompt', props: band })
    expect(await v.find({ key: 'off' }), 'no band when off').toBeUndefined()
    expect(await v.find({ text: 'REST' }), 'other bands still show').toBeDefined()
    await $.ui.mount({ plugin: 'screen-share', surface, component: 'AssistantMessage', props: { text: PRIVATE, isFirstOfReply: true } as never })
    expect(seen.assistant, 'nothing masked when off').toBe(PRIVATE)
    expect(statuses.at(-1), 'status line cleared').toBeUndefined()
  })
}

test('mask: 15 tricky strings', async () => {
  const mask = (s: string) => redact(s, (hit, kind) => `[${kind}]`)
  const cases: [string, string][] = [
    ['Mail jane.doe+leads@acme.co.uk today', 'Mail [email] today'],
    ['UK +44 7700 900123, US +1 (415) 555-0132', 'UK [phone], US [phone]'],
    ['US 415-555-0132, landline 020 7946 0958, mobile 07700 900123', 'US [phone], landline [phone], mobile [phone]'],
    ['India 98765 43210 and 9876543210 and +919876543210', 'India [phone] and [phone] and [phone]'],
    ['Paid $4,250.00, £900, €12k and ₹4,500', 'Paid [amount], [amount], [amount] and [amount]'],
    ['Budget USD 300, or 1,200 dollars, or Rs. 4,500', 'Budget [amount], or [amount], or [amount]'],
    ['In 2026 we used 182k tokens on v2.1.295', 'In 2026 we used 182k tokens on v2.1.295'],
    ['Dates 2026-10-15, 15.10.2026, 10/15/2026 at 14:30:00', 'Dates 2026-10-15, 15.10.2026, 10/15/2026 at 14:30:00'],
    ['Open /Users/test/clips/9876543210/a.mp4 and ~/x/415-555-0132.md', 'Open /Users/test/clips/9876543210/a.mp4 and ~/x/415-555-0132.md'],
    ['See https://site.com/u/9876543210?tel=447700900123 now', 'See https://site.com/u/9876543210?tel=447700900123 now'],
    ['Order 17600000001234, ts 1760000000000, window 1,000,000', 'Order 17600000001234, ts 1760000000000, window 1,000,000'],
    ['echo $1 and $HOME and ${x}', 'echo $1 and $HOME and ${x}'],
    ['Years 2024 2025 2026, range 2019-2026, IP 192.168.100.1', 'Years 2024 2025 2026, range 2019-2026, IP 192.168.100.1'],
    ['react@18.3.1, @anthropic-ai/sdk, git@github.com:me/repo', 'react@18.3.1, @anthropic-ai/sdk, git@github.com:me/repo'],
    ['Call +44 7700 900123 in 2026, +1234 -567 lines, 50% off', 'Call [phone] in 2026, +1234 -567 lines, 50% off'],
  ]
  for (const [input, want] of cases) expect(mask(input), input).toBe(want)
})

test('mask: names only where the text says it is a person', async () => {
  const tag = (s: string) => redact(s, (hit, kind) => `[${kind}]`)
  const cases: [string, string][] = [
    ['Jane Doe <jane@x.com>', '[name] <[email]>'],
    ['"Jane Doe" <jane@x.com>', '"[name]" <[email]>'],
    ['**From:** Jane Sample <jane@example.com>', '**From:** [name] <[email]>'],
    ['To: Jane Doe, Bob Smith and Ravi Kumar', 'To: [name], [name] and [name]'],
    ['Contact Bob Smith (bob@acme.co.uk) today', 'Contact [name] ([email]) today'],
    ['| Ravi Kumar | ravi@x.in | ₹4,500 |', '| [name] | [email] | [amount] |'],
    ['jane@x.com (Jane Doe)', '[email] ([name])'],
    ['{"name": "Jane Doe", "email": "jane@x.com"}', '{"name": "[name]", "email": "[email]"}'],
    ['"full_name": "José Álvarez"', '"full_name": "[name]"'],
    ['{"name": "screen-share", "version": "0.1.0"}', '{"name": "screen-share", "version": "0.1.0"}'],
    ['Hi Jane, the API Key is ready. Note: Run This Now', 'Hi Jane, the API Key is ready. Note: Run This Now'],
    ['Customer Success: help@x.com', 'Customer Success: [email]'],
  ]
  for (const [input, want] of cases) expect(tag(input), input).toBe(want)
  const line = 'From: Jane Doe <jane@x.com>, call +44 7700 900123 about $4,250.00'
  expect(mask(line).length, 'bars keep the line length').toBe(line.length)
})
