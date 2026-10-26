import type { EngineInterface, Register } from 'claude-code'

import { BAR, FADE, mask, maskDeep } from './mask'

// Screen-Share Mode: /screen-share turns it on or off. (/share cannot be used: it
// is the built-in /bug's other name, and the engine refuses to register it.) While on, the transcript rows
// draw emails, phone numbers, money amounts and names as shaded bars of the
// same length (▒▒▒▒ ▒▒▒), so lines keep their length and nothing jumps.
// Only the drawing changes: the stored chat, and what Claude reads, stay real.
//
// Hover to reveal is not done: these rows are drawn by the engine from a
// markdown string, and hover styles only apply to a Text or Box the mod draws
// itself. Drawing our own rows would lose the engine's markdown.

const ON = { plugin: 'screen-share', key: 'on' } as const
const ACCENT = '#d97757'
const BAND_TEXT = ' Screen-share mode: emails, phones, amounts and names hidden on screen'

// Module variables reset on a reload; the mode itself lives in $.state and $.store.
let sid = ''
let home = ''
// The bar glyph rows draw with now: light for the first frame after turning
// on, then the full bar. A fade in of one step, 150 ms.
let glyph = BAR
const FADE_MS = 150

// The /mods switchboard turns this mod off in every chat with switches.json.
const NAME = 'screen-share'
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
  try {
    // The status line follows the switch: hidden while off, back when on again.
    const { value } = await $.state.get(ON)
    await $.ui.status(!off && value === true ? 'Screen-share on' : undefined)
  } catch {
    // The status line is a nicety.
  }
}

async function logError($: EngineInterface, where: string, err: unknown) {
  try {
    const path = `${home || '~'}/.claude/mods-logs/screen-share.log`
    let old = ''
    try {
      old = String(await $.fs.read(path))
    } catch {
      // First error: no log yet.
    }
    const at = new Date(await $.clock.now()).toISOString()
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    await $.fs.write(path, `${old}${at} ${where}: ${msg}\n`)
  } catch {
    // Logging must never break the screen.
  }
}

async function isOn($: EngineInterface) {
  if (off) return false
  const { value } = await $.state.get(ON)
  return value === true
}

// Every row this mod hooks is drawn again now, old messages included, instead
// of at the next state redraw.
function redrawAll($: EngineInterface) {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The state write below redraws anyway, a little later.
  }
}

async function setMode($: EngineInterface, on: boolean) {
  glyph = on ? FADE : BAR
  await $.state.set(ON, on)
  redrawAll($)
  if (on) {
    $.clock.after(FADE_MS, () => {
      glyph = BAR
      redrawAll($)
    })
  }
  try {
    await $.ui.status(on ? 'Screen-share on' : undefined)
  } catch (err) {
    await logError($, 'ui.status', err)
  }
  try {
    if (sid) await $.store.set(`on:${sid}`, on)
  } catch (err) {
    await logError($, 'store.set', err)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'screen-share',
      description: 'Screen-Share Mode on or off: hides emails, phone numbers, amounts and names on screen (Claude still reads the real data)',
      argumentHint: '[on|off]',
      // Works at once, also while Claude is busy, instead of after the turn.
      immediate: true,
    })
    try {
      sid = await $.session.id()
      home = $.plugin.root.split('/.claude/')[0] ?? ''
      await readSwitch($).catch(() => undefined)
      $.clock.every(3000, () => {
        void readSwitch($).catch(() => undefined)
      })
      // A reload keeps the mode this chat had.
      const saved = await $.store.get(`on:${sid}`)
      if (saved === true && (await $.state.get(ON)).value !== true) {
        await $.state.set(ON, true)
        if (!off) await $.ui.status('Screen-share on')
      }
    } catch (err) {
      await logError($, 'session.start', err)
    }
    return next(e)
  })

  on('command.run', { command: 'screen-share' }, async ($, e) => {
    if (off) return { text: 'Screen-Share Mode is off. Turn it on with /mods.' }
    try {
      const arg = String((e as { args?: string }).args ?? '').trim().toLowerCase()
      const now = await isOn($)
      const want = arg === 'on' ? true : arg === 'off' ? false : !now
      await setMode($, want)
      return {
        text: want
          ? 'Screen-share on. Emails, phone numbers, amounts and names show as shaded bars on screen. Claude still reads the real data. Run /screen-share again to turn it off.'
          : 'Screen-share off. Everything shows as normal.',
      }
    } catch (err) {
      await logError($, 'command.run', err)
      return { text: 'Screen-share could not switch. See ~/.claude/mods-logs/screen-share.log.' }
    }
  })

  on('ui.press', { plugin: 'screen-share', element: 'off' }, async ($, e) => {
    try {
      await setMode($, false)
    } catch (err) {
      await logError($, 'ui.press', err)
    }
    return { element: e.element }
  })

  // The transcript rows. Each hook reads the mode while drawing, so a switch
  // redraws every row that read it. Nothing changed: the props pass as they came.

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const text = mask(e.props.text, glyph)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const text = mask(e.props.text, glyph)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const text = mask(e.props.text, glyph)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const input = maskDeep(e.props.input, glyph)
    const output = maskDeep(e.props.output, glyph)
    if (input === e.props.input && output === e.props.output) return next(e)
    return next({ ...e, props: { ...e.props, input, output } })
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const output = maskDeep(e.props.output, glyph)
    return output === e.props.output ? next(e) : next({ ...e, props: { ...e.props, output } })
  })

  // The folded group line only counts calls ("Read 3 files"); its unfolded rows
  // are ToolUse rows, masked above. The calls are masked too, for any surface
  // that draws a detail from them.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const calls = maskDeep(e.props.calls, glyph)
    return calls === e.props.calls ? next(e) : next({ ...e, props: { ...e.props, calls } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await isOn($))) return next(e)
    const rest = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const noop = () => undefined
    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Text wrap="truncate-end">
            <Text color={ACCENT}>●</Text>
            <Text dimColor>{BAND_TEXT}</Text>
          </Text>
          <Button key="off" label="Turn off" onPress={noop} />
        </Box>
      </Box>
    )
  })
}
