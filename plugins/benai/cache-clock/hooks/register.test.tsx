import { expect, mock, test } from 'claude-code/testing'

for (const surface of ['desktop', 'terminal'] as const) {
  test(`counts down, goes cold, offers a handoff on a big chat (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    // An older version saved the 60 s demo for every chat; a new chat must not use it.
    const store: Record<string, unknown> = { demo: true }
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('turn.start', async () => ({}) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens: 182_000, window: 1_000_000 } } }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '5m\n', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => ({ value: (e as { path: string }).path in files }) as never)
    on('fs.read', async ($, e) => ({ value: files[(e as { path: string }).path] ?? '' }) as never)
    on('fs.write', async ($, e) => {
      const { path, text } = e as { path: string; text: string }
      files[path] = text
      return { value: undefined } as never
    })
    on('store.get', async ($, e) => ({ value: store[(e as { key: string }).key] }) as never)
    on('store.set', async ($, e) => {
      const { key, value } = e as { key: string; value: unknown }
      store[key] = value
      return { value: undefined } as never
    })
    const toasts: string[] = []
    on('ui.toast', async ($, e) => {
      toasts.push((e as { text: string }).text)
      return { value: undefined } as never
    })
    on('turn.complete', async () => ({ text: '' }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    const props = { isWorking: false, hasSurvey: false, maxRows: 10, bodyColumns: 100 } as never
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)

    let v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'hide' }), 'nothing before the first reply').toBeUndefined()

    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    await clock.advance(30_000)
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Cache\ warm/ }), 'warm with time left').toBeDefined()
    expect(await v.find({ text: /4:30/ }), '4:30 left after 30 s of a 5 min cache').toBeDefined()
    expect(await v.find({ text: /5 min cache, as Anthropic's last reply set it/ }), 'says where the length comes from').toBeDefined()
    expect(store.demo, 'the old demo setting is cleared').toBe(false)
    expect(await v.find({ key: 'handoff' }), 'no handoff while warm').toBeUndefined()

    await clock.advance(5 * 60_000)
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Cache\ cold/ }), 'cold after 5 min').toBeDefined()
    expect(await v.find({ text: /182k tokens/ }), '182k tokens').toBeDefined()
    await v.press({ key: 'handoff' })
    const req = Object.keys(files).find(k => k.endsWith('/.claude/handoffs/.request-sid'))
    expect(req ?? '', 'handoff request file written').toContain('.request-sid')

    await v.press({ key: 'hide' })
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'hide' }), 'hidden').toBeUndefined()
    const sw = Object.keys(files).find(k => k.endsWith('/.claude/mods/switches.json')) ?? ''
    expect(JSON.parse(files[sw] ?? '{}'), 'Hide writes the shared flag').toEqual({ 'cache-clock:hidden': true })
    expect(toasts.join(' '), 'the toast names the way back').toContain('/cacheclock')

    // A new reply does not bring it back: only /cacheclock or /mods does.
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Cache\ warm/ }), 'still hidden after a reply').toBeUndefined()
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`clearing the hidden flag draws the clock again (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    let flag = JSON.stringify({ 'cache-clock:hidden': true })
    const isSwitches = (e: unknown) => (e as { path: string }).path.endsWith('/.claude/mods/switches.json')
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('turn.start', async () => ({}) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens: 182_000, window: 1_000_000 } } }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '5m\n', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => ({ value: isSwitches(e) ? flag !== '' : (e as { path: string }).path in files }) as never)
    on('fs.read', async ($, e) => ({ value: isSwitches(e) ? flag : (files[(e as { path: string }).path] ?? '') }) as never)
    on('fs.write', async ($, e) => {
      const { path, text } = e as { path: string; text: string }
      if (isSwitches(e)) flag = text
      else files[path] = text
      return { value: undefined } as never
    })
    on('store.get', async () => ({ value: undefined }) as never)
    on('store.set', async () => ({ value: undefined }) as never)
    on('turn.complete', async () => ({ text: '' }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    const props = { isWorking: false, hasSurvey: false, maxRows: 10, bodyColumns: 100 } as never
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    let v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Cache\ warm/ }), 'hidden while the flag is set').toBeUndefined()
    expect(await v.find({ text: 'REST' }), 'other bands still draw').toBeDefined()

    // /mods (or another chat) clears the flag: the 3 s poll brings the clock back.
    flag = '{}'
    await clock.advance(3100)
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Cache\ warm/ }), 'clock back').toBeDefined()

    // /cacheclock hide, then /cacheclock shows it again; each reply names the way back.
    let said = JSON.stringify(await $.command.run({ command: 'cacheclock', args: 'hide' } as never))
    expect(said, 'hide reply').toContain('Cache Clock hidden')
    expect(said, 'hide reply names the way back').toContain('/cacheclock or open /mods')
    expect(JSON.parse(flag), 'flag set by /cacheclock hide').toEqual({ 'cache-clock:hidden': true })
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Cache\ warm/ }), 'hidden by the command').toBeUndefined()
    said = JSON.stringify(await $.command.run({ command: 'cacheclock', args: '' } as never))
    expect(said, 'show reply').toContain('Cache Clock is on')
    expect(JSON.parse(flag), 'flag cleared by /cacheclock').toEqual({})
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Cache\ warm/ }), 'shown by the command').toBeDefined()
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`draws nothing of its own when switched off in /mods (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    let switches = ''
    const isSwitches = (e: unknown) => (e as { path: string }).path.endsWith('/.claude/mods/switches.json')
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('turn.start', async () => ({}) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens: 182_000, window: 1_000_000 } } }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '5m\n', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => ({ value: isSwitches(e) && switches !== '' }) as never)
    on('fs.read', async ($, e) => ({ value: isSwitches(e) ? switches : '' }) as never)
    on('fs.write', async () => ({ value: undefined }) as never)
    on('store.get', async () => ({ value: undefined }) as never)
    on('store.set', async () => ({ value: undefined }) as never)
    on('turn.complete', async () => ({ text: '' }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    const props = { isWorking: false, hasSurvey: false, maxRows: 10, bodyColumns: 100 } as never
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    let v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Cache\ warm/ }), 'clock shows while on').toBeDefined()

    switches = JSON.stringify({ 'cache-clock': false })
    await clock.advance(3100)
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ key: 'hide' }), 'no clock when off').toBeUndefined()
    expect(await v.find({ text: 'REST' }), 'other bands still draw').toBeDefined()
    const said = await $.command.run({ command: 'cacheclock', args: '' } as never)
    expect(JSON.stringify(said), 'the command says it is off').toContain('Turn it on with /mods')
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`keep warm: the button turns it on, a ping fires before expiry, a prompt stops it (${surface})`, { timeoutMs: 60000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const toasts: string[] = []
    const forks: string[] = []
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('turn.start', async () => ({}) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens: 182_000, window: 1_000_000 } } }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '5m\n', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => ({ value: (e as { path: string }).path in files }) as never)
    on('fs.read', async ($, e) => ({ value: files[(e as { path: string }).path] ?? '' }) as never)
    on('fs.write', async ($, e) => {
      const { path, text } = e as { path: string; text: string }
      files[path] = text
      return { value: undefined } as never
    })
    on('store.get', async () => ({ value: undefined }) as never)
    on('store.set', async () => ({ value: undefined }) as never)
    on('ui.toast', async ($, e) => {
      toasts.push((e as { text: string }).text)
      return { value: undefined } as never
    })
    on('model.fork', async ($, e) => {
      forks.push((e as { prompt: string }).prompt)
      return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 182_000, cache_creation_input_tokens: 0 } } } as never
    })
    on('prompt.submit', async ($, e) => ({ text: (e as { text: string }).text }) as never)
    on('turn.complete', async () => ({ text: '' }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    const props = { isWorking: false, hasSurvey: false, maxRows: 10, bodyColumns: 120 } as never
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()

    let v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Each ping reads the chat from cache/ }), 'the tip line shows').toBeDefined()
    expect(await v.find({ text: /\$/ }), 'no money amounts').toBeUndefined()
    await v.press({ key: 'keepwarm' })
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Keeping warm · first ping in 4:15/ }), 'on, first ping 45 s before the end').toBeDefined()

    // 4 min in: 60 s left, still too early.
    await clock.advance(4 * 60_000)
    expect(forks.length, 'no ping with 60 s left').toBe(0)
    // 45 s before the end: one ping, with the tiny prompt.
    await clock.advance(16_000)
    await clock.settle()
    expect(forks.length, 'one ping before expiry').toBe(1)
    expect(forks[0], 'the tiny prompt').toBe('Reply with the single word: ok')
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Keeping warm · ping 1 · next in 4:1\d · last ping read 182k cached tokens/ }), 'band after the ping').toBeDefined()
    expect(await v.find({ text: /Cache warm/ }), 'the clock went back to a full cache').toBeDefined()
    expect(await v.find({ text: /4:[45]\d/ }), 'close to 5:00 left again').toBeDefined()
    const logPath = Object.keys(files).find(k => k.endsWith('/.claude/mods-logs/cache-clock.log')) ?? ''
    expect(files[logPath] ?? '', 'the ping is logged').toContain('ping 1: cache read 182000, cache write 0, error none')

    // The next ping comes one cycle later: about 4:15 after the first.
    await clock.advance(4 * 60_000 + 16_000)
    await clock.settle()
    expect(forks.length, 'a second ping one cycle later').toBe(2)

    // Its own command does not stop it; a real prompt does.
    await $.prompt.submit({ text: '/keepwarm' } as never)
    await clock.settle()
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Keeping warm/ }), 'still on after its own command').toBeDefined()
    await $.prompt.submit({ text: 'back again' } as never)
    await clock.settle()
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Keeping warm/ }), 'stopped by a prompt').toBeUndefined()
    expect(toasts.join(' '), 'the toast says why').toContain('you sent a message')
    await clock.advance(10 * 60_000)
    expect(forks.length, 'no more pings once stopped').toBe(2)
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`keep warm stops by itself after 30 pings, and says when the cache had gone cold (${surface})`, { timeoutMs: 120000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const store: Record<string, unknown> = {}
    const toasts: string[] = []
    let forks = 0
    let cold = false
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('turn.start', async () => ({}) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens: 182_000, window: 1_000_000 } } }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '5m\n', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => ({ value: (e as { path: string }).path in files }) as never)
    on('fs.read', async ($, e) => ({ value: files[(e as { path: string }).path] ?? '' }) as never)
    on('fs.write', async ($, e) => {
      const { path, text } = e as { path: string; text: string }
      files[path] = text
      return { value: undefined } as never
    })
    on('store.get', async ($, e) => ({ value: store[(e as { key: string }).key] }) as never)
    on('store.set', async ($, e) => {
      const { key, value } = e as { key: string; value: unknown }
      store[key] = value
      return { value: undefined } as never
    })
    on('ui.toast', async ($, e) => {
      toasts.push((e as { text: string }).text)
      return { value: undefined } as never
    })
    on('model.fork', async () => {
      forks += 1
      const usage = cold
        ? { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 182_000 }
        : { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 182_000, cache_creation_input_tokens: 0 }
      return { value: { isAnswered: true, text: 'ok', usage } } as never
    })
    on('turn.complete', async () => ({ text: '' }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    const props = { isWorking: false, hasSurvey: false, maxRows: 10, bodyColumns: 120 } as never
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    // The 60 s demo cache pings every 15 s, so 30 pings fit well inside the 2 hour cap.
    await $.command.run({ command: 'cacheclock', args: 'demo' } as never)
    const early = JSON.stringify(await $.command.run({ command: 'keepwarm', args: '' } as never))
    expect(early, 'nothing to keep warm before the first reply').toContain('Nothing to keep warm yet')
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    const said = JSON.stringify(await $.command.run({ command: 'keepwarm', args: '' } as never))
    expect(said, '/keepwarm turns it on').toContain('Keep warm is on')

    // A cache write in place of a read is said plainly.
    cold = true
    for (let i = 0; i < 16; i++) await clock.advance(1000)
    await clock.settle()
    expect(forks, 'first ping').toBe(1)
    let v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /the cache had gone cold, so ping 1 wrote 182k tokens to it again/ }), 'cold write said plainly').toBeDefined()
    cold = false

    for (let i = 0; i < 600 && forks < 31; i++) await clock.advance(1000)
    await clock.settle()
    expect(forks, 'exactly 30 pings').toBe(30)
    expect(toasts.join(' '), 'the stop toast names the cap').toContain('after 30 pings')
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Keeping warm/ }), 'off after the cap').toBeUndefined()
    expect(await v.find({ key: 'keepwarm' }), 'the button is back to Keep warm').toBeDefined()

    // /keepwarm toggles; /keepwarm off stops it.
    await $.command.run({ command: 'keepwarm', args: '' } as never)
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Keeping warm/ }), 'on again').toBeDefined()
    const offSaid = JSON.stringify(await $.command.run({ command: 'keepwarm', args: 'off' } as never))
    expect(offSaid, '/keepwarm off').toContain('Keep warm is off')
    v = await $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Keeping warm/ }), 'off by the command').toBeUndefined()
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`keep warm stops when Cache Clock is switched off in /mods (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    let switches = ''
    const toasts: string[] = []
    let forks = 0
    const isSwitches = (e: unknown) => (e as { path: string }).path.endsWith('/.claude/mods/switches.json')
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('turn.start', async () => ({}) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens: 182_000, window: 1_000_000 } } }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '5m\n', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => ({ value: isSwitches(e) && switches !== '' }) as never)
    on('fs.read', async ($, e) => ({ value: isSwitches(e) ? switches : '' }) as never)
    on('fs.write', async () => ({ value: undefined }) as never)
    on('store.get', async () => ({ value: undefined }) as never)
    on('store.set', async () => ({ value: undefined }) as never)
    on('ui.toast', async ($, e) => {
      toasts.push((e as { text: string }).text)
      return { value: undefined } as never
    })
    on('model.fork', async () => {
      forks += 1
      return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } } } as never
    })
    on('turn.complete', async () => ({ text: '' }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    await $.command.run({ command: 'keepwarm', args: '' } as never)
    switches = JSON.stringify({ 'cache-clock': false })
    await clock.advance(3100)
    expect(toasts.join(' '), 'the toast says it was turned off').toContain('turned off in /mods')
    await clock.advance(10 * 60_000)
    expect(forks, 'no ping while off').toBe(0)
    const said = JSON.stringify(await $.command.run({ command: 'keepwarm', args: '' } as never))
    expect(said, '/keepwarm says it is off').toContain('Turn it on with /mods')
  })
}
