// Conduit change: the first tests for this mod, for Windows paths and platform.mjs.
import { expect, mock, test } from 'claude-code/testing'

import { homeOf, isWindows, removeFile } from './platform.mjs'

for (const surface of ['desktop', 'terminal'] as const) {
  test(`an edit on Windows shows its path relative to the working folder (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.cwd', async () => ({ value: 'C:\\Users\\test\\proj' }) as never)
    on('fs.exists', async () => ({ value: false }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
    on('tool.call', async () => ({ result: 'ok' }) as never)
    on('turn.start', async () => ({}) as never)
    on('turn.complete', async () => ({ text: '' }) as never)
    await $.session.start({ source: 'startup', cwd: 'C:\\Users\\test\\proj', surface, isInteractive: true } as never)
    await clock.settle()
    // A plain signature: the full overloads are too deep for tsc.
    const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
    await call({ tool: 'Edit', tool_use_id: 'e1', file_path: 'C:\\Users\\test\\proj\\src\\app.ts', old_string: 'a', new_string: 'b' })
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    const v = await $.ui.mount({
      plugin: 'replay-theater',
      surface,
      component: 'Pane',
      requestId: 'replay-theater',
      props: { title: 'Replay Theater', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
    })
    expect(await v.find({ text: /^src\\app\.ts$/ }), 'the path inside the working folder').toBeDefined()
  })
}

test('platform: a Windows plugin root finds home and deletes with del', async () => {
  const root = 'C:\\Users\\colin\\.claude\\plugins\\cache\\conduit-mods\\replay-theater\\0.1.1'
  expect(isWindows(root), 'a drive letter is Windows').toBe(true)
  expect(homeOf(root), 'home on Windows').toBe('C:\\Users\\colin')
  expect(homeOf('/Users/colin/.claude/plugins/cache/conduit-mods/replay-theater/0.1.1'), 'home on a Mac').toBe('/Users/colin')
  const runs: (readonly string[])[] = []
  const run = async (argv: readonly string[]) => {
    runs.push(argv)
    return { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  await removeFile({ plugin: { name: 'replay-theater', root }, process: { run } } as never, 'C:\\Users\\colin/.claude/mods/.open-replay-theater-sid')
  expect(runs[0], 'del, backslashes').toEqual(['cmd.exe', '/d', '/c', 'del', '/f', '/q', 'C:\\Users\\colin\\.claude\\mods\\.open-replay-theater-sid'])
  await removeFile({ plugin: { name: 'replay-theater', root: '/Users/colin/.claude/plugins/cache/x' }, process: { run } } as never, '/Users/colin/.claude/mods/.open-replay-theater-sid')
  expect(runs[1], 'rm -f on a Mac').toEqual(['rm', '-f', '/Users/colin/.claude/mods/.open-replay-theater-sid'])
})
