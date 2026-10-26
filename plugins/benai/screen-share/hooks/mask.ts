// The masking rules for Screen-Share Mode. Pure functions, no engine calls.
// Conservative on purpose: a year, a version, a token count like 182k or a file
// path must never be hidden. A miss is better than hiding plain numbers.
//
// Each hidden span is drawn as a shaded bar of the same length as the text it
// hides (spaces stay spaces), so a line keeps its length and wrapping.

export type Kind = 'email' | 'phone' | 'amount' | 'name'
type Span = { a: number; b: number; kind: Kind }

/** The bar a hidden span is drawn with, and the lighter one of the fade in. */
export const BAR = '▒'
export const FADE = '░'

// Every regex is built once, here, when the module loads.

// An ssh remote (git@github.com:me/repo) is not an email and stays.
const EMAIL_SRC = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}(?![A-Za-z0-9-])(?!:[\w~/])`
const EMAIL_RE = new RegExp(EMAIL_SRC, 'g')

// Links: phone and money hits inside one are left alone (ids, query strings).
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi

// Money. The number part: 4,500 / 4500 / 4,250.00 / 12.5
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`
const SCALE = String.raw`(?:\s?(?:k|K|m|M|bn|mn|b|B)\b|\s(?:thousand|million|billion|lakh|lakhs|crore|crores)\b)`
const CODES = 'USD|GBP|EUR|INR|AUD|CAD|NZD|SGD|AED|JPY|CHF|HKD'
const MONEY_RES: RegExp[] = [
  // $1,234.56  £900  €12k  ₹4,500  US$300  -$40  \$500 (escaped in markdown)
  new RegExp(String.raw`(?<![\w$])(?:US|AU|CA|NZ|HK|S|A|C)?\\?[$£€₹¥]\s?(?:${NUM})${SCALE}?(?![\w%])`, 'g'),
  // USD 300  INR 4,500  Rs. 900  Rs 1.2 lakh
  new RegExp(String.raw`(?<![\w])(?:${CODES}|Rs\.?)\s?(?:${NUM})${SCALE}?(?![\w%])`, 'g'),
  // 1,200 dollars  300 USD  12€  5k euros
  new RegExp(String.raw`(?<![\w.,])(?:${NUM})${SCALE}?\s?(?:${CODES}|€|dollars?|euros?|rupees?|bucks)(?![\w])`, 'g'),
]
const BARE_ARG_RE = /^\\?\$\d$/

// Phone shapes. Each needs a boundary that is not a letter, digit, slash, dot,
// hyphen, hash, equals sign or @ on either side, so ids and paths stay.
const LEFT = String.raw`(?<![\w/\\.#=@+$£€₹-])`
const RIGHT = String.raw`(?![\w/\\@%-]|\.\d|,\d)`
const PHONE_RES: RegExp[] = [
  // International: +44 7700 900123, +1 (415) 555-0132, +91 98765 43210, +919876543210
  new RegExp(String.raw`${LEFT}\+\d{1,3}(?:[ .-]?\(?\d{1,5}\)?){1,6}${RIGHT}`, 'g'),
  // US: (415) 555-0132, 415-555-0132, 415.555.0132, 415 555 0132, 1-415-555-0132
  new RegExp(String.raw`${LEFT}(?:1[ .-])?(?:\(\d{3}\)\s?|\d{3}[ .-])\d{3}[ .-]\d{4}${RIGHT}`, 'g'),
  // UK: 07700 900123, 020 7946 0958, (020) 7946 0958, 01632 960983
  new RegExp(String.raw`${LEFT}(?:\(0\d{2,4}\)|0\d{2,4})[ -]?\d{3,4}[ -]?\d{3,4}${RIGHT}`, 'g'),
  // India: 98765 43210, 98765-43210, 098765 43210, 9876543210
  new RegExp(String.raw`${LEFT}0?[6-9]\d{4}[ -]?\d{5}${RIGHT}`, 'g'),
]

// A date or a time is never a phone, whatever its separators.
const DATE_RES: RegExp[] = [
  /^\(?(?:19|20)\d{2}[ .-](?:0?[1-9]|1[0-2])[ .-](?:0?[1-9]|[12]\d|3[01])\b/,
  /^\(?(?:0?[1-9]|[12]\d|3[01])[ .-](?:0?[1-9]|1[0-2])[ .-](?:19|20)\d{2}\b/,
  /^\(?(?:0?[1-9]|1[0-2])[ .-](?:0?[1-9]|[12]\d|3[01])[ .-](?:19|20)\d{2}\b/,
]
// Runs of plain years, "2024 2025 2026", read like a number but are not one.
const YEARS_RE = /^(?:(?:19|20)\d{2}[ .-]?){2,}$/
const NON_DIGIT_RE = /\D/g
const PLUS_RE = /^\+/
const LAST_GROUP_RE = /[ .-]?\(?\d+\)?$/
const QUICK_RE = /[@\d:]/

// Names. Only where the text says it is a person: "Name <email>", a name in
// brackets or a table cell next to an email, a From:/To:/Cc: line, or a name
// key in JSON. Never a guess at every capitalised word.
const WORD = String.raw`\p{Lu}[\p{L}\p{M}'’.-]*`
// Lowercase particles inside a name: Ben van Sprundel, Ana de la Cruz.
const PARTICLE = String.raw`(?:van|von|de|der|den|da|di|du|la|le|del|dos|das|bin|ibn|al)`
const WORDS = String.raw`${WORD}(?:[ \t]+(?:${PARTICLE}[ \t]+){0,2}${WORD}){0,3}`
const NB = String.raw`(?<![\p{L}\p{N}_@.])`
// Each email is looked at once, with a short window of text either side of
// it, instead of running every name pattern over the whole message.
const WINDOW = 80
const NAME_WORD_RE = new RegExp(String.raw`^${WORD}$`, 'u')
const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'da', 'di', 'du', 'la', 'le', 'del', 'dos', 'das', 'bin', 'ibn', 'al'])
const BEFORE_SEPS = '<(,:|-–—'
const LEAD_PUNCT = '*_"\'([|>'
// "Jane Doe" <jane@
const QUOTED_RE = /"([^"\n<>@]{1,60})"[ \t]*<[ \t]*$/
// jane@x.com (Jane Doe) | jane@x.com | Jane Doe |
const AFTER_RE = new RegExp(String.raw`^>?[ \t]*(?:\([ \t]*(${WORDS})[ \t]*\)|\|[ \t]*(${WORDS})[ \t]*\|)`, 'u')
// Words that open a phrase but are not part of the name after them.
const STOP = new Set([
  'From', 'To', 'Cc', 'Bcc', 'Mail', 'Email', 'E-mail', 'Contact', 'Call', 'Hi', 'Hello', 'Hey', 'Dear',
  'Thanks', 'Ask', 'Ping', 'Message', 'Write', 'Send', 'Reply', 'By', 'And', 'Or', 'The', 'Sender',
  'Recipient', 'With', 'Via', 'Name', 'Owner', 'Lead', 'Customer', 'Client',
])
// A From:, To:, Cc: style line, markdown bold allowed around the label.
const HEADER_RE = /^([ \t>*_-]*[*_]{0,2}(?:From|To|Cc|Bcc|Reply-To|Sender|Recipients?|Attendees?|Organi[sz]er|Invitees?|Guests?|Contact|Full[ _]name|Name)[*_]{0,2}[ \t]*:[*_]{0,2}[ \t]*)([^\n]*)$/gim
const PART_SPLIT_RE = /,|;|[ \t]+and[ \t]+|[ \t]+&[ \t]+/g
const PART_NAME_RE = new RegExp(String.raw`^[ \t]*[*_"']{0,2}(${WORDS})[*_"']{0,2}[ \t]*(?=$|<|\(|\[)`, 'u')
// JSON: "full_name": "Jane Doe", and "name" inside an object that has an email.
const NAME_KEY_JSON_RE = /"(?:full_?name|first_?name|last_?name|display_?name|given_?name|family_?name|sender_?name|from_?name|contact_?name|person_?name|author_?name|owner_?name)"\s*:\s*"([^"\\\n]{1,80})"/gi
const FLAT_OBJECT_RE = /\{[^{}]{0,3000}\}/g
const HAS_EMAIL_KEY_RE = /"e-?mail(?:_?address)?"\s*:/i
const NAME_JSON_RE = /"name"\s*:\s*"([^"\\\n]{1,80})"/g
const STARTS_LETTER_RE = /^[\p{L}]/u
const SPACE_RE = /\s/
const NOT_SPACE_RE = /\S/gu

/** Keys whose string value is a person's name (any case, _ optional). */
export const NAME_KEY_RE = /^(?:full_?name|first_?name|last_?name|display_?name|given_?name|family_?name|sender_?name|from_?name|contact_?name|person_?name|author_?name|owner_?name)$/i
const EMAIL_KEY_RE = /^e-?mail(?:_?address)?$/i

function digits(s: string) {
  return s.replace(NON_DIGIT_RE, '').length
}

function isPhone(hit: string) {
  const n = digits(hit)
  if (n < 9 || n > 15) return false
  const bare = hit.replace(PLUS_RE, '')
  if (DATE_RES.some(r => r.test(bare))) return false
  if (YEARS_RE.test(bare)) return false
  return true
}

// How much of a hit is the phone: the whole, or less once trailing groups that
// belong to the next number (a year after it) are cut off. 0 when none of it.
function phoneLength(hit: string) {
  let h = hit
  while (h) {
    if (isPhone(h)) return h.length
    const cut = h.replace(LAST_GROUP_RE, '')
    if (cut === h || digits(cut) < 9) return 0
    h = cut
  }
  return 0
}

// Which characters are already taken, one byte each: an overlap test is then
// a short scan of the hit, not a pass over every span found so far.
function taken(used: Uint8Array, a: number, b: number) {
  for (let i = a; i < b; i++) if (used[i]) return true
  return false
}

function take(used: Uint8Array, a: number, b: number) {
  used.fill(1, a, b)
}

// A name found at `at`: leading opener words (From, Hi, Contact) are dropped,
// and it needs at least `min` words left.
function addName(spans: Span[], name: string, at: number, min: number) {
  const words = name.split(/([ \t]+)/)
  let start = at
  while (words.length && STOP.has(words[0] ?? '')) {
    start += (words[0] ?? '').length + (words[1] ?? '').length
    words.splice(0, 2)
  }
  const kept = words.filter((_, i) => i % 2 === 0)
  if (kept.length < min || kept.length === 0) return
  const text = words.join('').replace(/[ \t]+$/, '')
  if (!text) return
  spans.push({ a: start, b: start + text.length, kind: 'name' })
}

// Walks back from an email over a separator (< ( , : | -) and up to four
// capitalised words. Plain string steps, no regex over the whole window.
function isBlank(c: string | undefined) {
  return c === ' ' || c === '\t'
}

function nameBefore(text: string, end: number, spans: Span[]) {
  let i = end
  while (isBlank(text[i - 1])) i--
  let sep = text[i - 1] ?? ''
  if (!sep || !BEFORE_SEPS.includes(sep)) return
  i--
  while (isBlank(text[i - 1])) i--
  // "Jane Doe, <jane@x.com>": the bracket sits after the real separator.
  const prev = text[i - 1] ?? ''
  if (sep === '<' && prev && prev !== '<' && BEFORE_SEPS.includes(prev)) {
    sep = prev
    i--
    while (isBlank(text[i - 1])) i--
  }
  const nameEnd = i
  const floor = Math.max(0, end - WINDOW)
  let start = -1
  let words = 0
  while (words < 4 && i > floor) {
    // The word that ends at i.
    let j = i
    while (j > floor && !SPACE_RE.test(text[j - 1] ?? ' ')) j--
    let w = j
    while (w < i && LEAD_PUNCT.includes(text[w] ?? '')) w++
    const word = text.slice(w, i)
    if (NAME_WORD_RE.test(word)) {
      start = w
      words++
    } else if (!(PARTICLES.has(word) && words > 0 && w === j)) break
    // Punctuation before a word, a line start or a wide gap ends the name.
    if (w !== j || j <= floor || !isBlank(text[j - 1])) break
    i = j
    while (isBlank(text[i - 1])) i--
    if (j - i > 2) break
  }
  if (start < 0 || nameEnd <= start) return
  addName(spans, text.slice(start, nameEnd), start, sep === '<' || sep === '(' ? 1 : 2)
}

function nameSpans(text: string, spans: Span[], emails: Span[]) {
  for (const e of emails) {
    let from = Math.max(0, e.a - WINDOW)
    // Start the window on a word boundary so a cut word is not read as a name.
    while (from > 0 && !SPACE_RE.test(text[from - 1] ?? ' ')) from++
    const before = text.slice(from, e.a)
    const q = QUOTED_RE.exec(before)
    if (q && q[1]) addName(spans, q[1], from + (q.index ?? 0) + 1, 1)
    else nameBefore(text, e.a, spans)
    const after = text.slice(e.b, e.b + WINDOW)
    const n = AFTER_RE.exec(after)
    const name = n?.[1] ?? n?.[2]
    if (n && name) addName(spans, name, e.b + (n.index ?? 0) + n[0].indexOf(name), n[1] ? 1 : 2)
  }
  if (text.includes(':')) {
    HEADER_RE.lastIndex = 0
    for (const m of text.matchAll(HEADER_RE)) {
      const label = m[1] ?? ''
      const rest = m[2] ?? ''
      const at = (m.index ?? 0) + label.length
      let last = 0
      PART_SPLIT_RE.lastIndex = 0
      const parts: Array<[string, number]> = []
      for (const sep of rest.matchAll(PART_SPLIT_RE)) {
        parts.push([rest.slice(last, sep.index), last])
        last = (sep.index ?? 0) + sep[0].length
      }
      parts.push([rest.slice(last), last])
      for (const [part, off] of parts) {
        const pm = PART_NAME_RE.exec(part)
        if (!pm || !pm[1]) continue
        addName(spans, pm[1], at + off + part.indexOf(pm[1]), 1)
      }
    }
  }
  if (text.includes('"')) {
    NAME_KEY_JSON_RE.lastIndex = 0
    for (const m of text.matchAll(NAME_KEY_JSON_RE)) {
      const v = m[1] ?? ''
      if (STARTS_LETTER_RE.test(v)) spans.push({ a: (m.index ?? 0) + m[0].length - 1 - v.length, b: (m.index ?? 0) + m[0].length - 1, kind: 'name' })
    }
    if (text.includes('@')) {
      FLAT_OBJECT_RE.lastIndex = 0
      for (const o of text.matchAll(FLAT_OBJECT_RE)) {
        if (!HAS_EMAIL_KEY_RE.test(o[0])) continue
        NAME_JSON_RE.lastIndex = 0
        for (const m of o[0].matchAll(NAME_JSON_RE)) {
          const v = m[1] ?? ''
          const end = (o.index ?? 0) + (m.index ?? 0) + m[0].length - 1
          if (STARTS_LETTER_RE.test(v)) spans.push({ a: end - v.length, b: end, kind: 'name' })
        }
      }
    }
  }
}

/** Every private span in `text`, sorted and merged. */
export function findSpans(text: string): Span[] {
  const spans: Span[] = []
  if (!text || typeof text !== 'string') return spans
  const hasAt = text.includes('@')
  if (hasAt) {
    EMAIL_RE.lastIndex = 0
    for (const m of text.matchAll(EMAIL_RE)) spans.push({ a: m.index ?? 0, b: (m.index ?? 0) + m[0].length, kind: 'email' })
  }
  const emails = spans.slice()
  if (/\d/.test(text)) {
    const used = new Uint8Array(text.length)
    for (const e of emails) take(used, e.a, e.b)
    const inLink = new Uint8Array(text.length)
    URL_RE.lastIndex = 0
    for (const m of text.matchAll(URL_RE)) take(inLink, m.index ?? 0, (m.index ?? 0) + m[0].length)
    for (const re of MONEY_RES) {
      re.lastIndex = 0
      for (const m of text.matchAll(re)) {
        const a = m.index ?? 0
        const b = a + m[0].length
        if (BARE_ARG_RE.test(m[0]) || taken(inLink, a, b) || taken(used, a, b)) continue
        spans.push({ a, b, kind: 'amount' })
        take(used, a, b)
      }
    }
    for (const re of PHONE_RES) {
      re.lastIndex = 0
      for (const m of text.matchAll(re)) {
        const a = m.index ?? 0
        const n = phoneLength(m[0])
        if (n === 0 || taken(inLink, a, a + m[0].length) || taken(used, a, a + n)) continue
        spans.push({ a, b: a + n, kind: 'phone' })
        take(used, a, a + n)
      }
    }
  }
  nameSpans(text, spans, emails)
  if (spans.length < 2) return spans
  spans.sort((x, y) => x.a - y.a || y.b - x.b)
  const out: Span[] = []
  for (const s of spans) {
    const prev = out[out.length - 1]
    if (prev && s.a <= prev.b) {
      if (s.b > prev.b) prev.b = s.b
    } else out.push({ ...s })
  }
  return out
}

/** A bar as long as `hit`: every character but a space becomes `glyph`. */
export function bar(hit: string, glyph = BAR) {
  return hit.replace(NOT_SPACE_RE, glyph)
}

/**
 * Rewrites every private span of `text` with `draw(hit, kind)`. Returns the
 * same string when nothing is private.
 */
export function redact(text: string, draw: (hit: string, kind: Kind) => string): string {
  if (!text || typeof text !== 'string') return text
  // Quick exit: nothing that could be private.
  if (!QUICK_RE.test(text)) return text
  const spans = findSpans(text)
  if (spans.length === 0) return text
  let out = ''
  let at = 0
  for (const s of spans) {
    out += text.slice(at, s.a) + draw(text.slice(s.a, s.b), s.kind)
    at = s.b
  }
  return out + text.slice(at)
}

// Rows draw again on every scroll and redraw, so a long text is masked once
// per glyph and kept.
const cache = new Map<string, string>()
const CACHE_MAX = 400

/** Hides emails, phone numbers, money amounts and names in one string. */
export function mask(text: string, glyph = BAR): string {
  if (!text || typeof text !== 'string') return text
  const long = text.length >= 200
  const key = long ? glyph + text : ''
  if (long) {
    const hit = cache.get(key)
    if (hit !== undefined) return hit
  }
  const out = redact(text, hit => bar(hit, glyph))
  if (long) {
    if (cache.size >= CACHE_MAX) {
      const first = cache.keys().next().value
      if (first !== undefined) cache.delete(first)
    }
    cache.set(key, out)
  }
  return out
}

/**
 * Masks every string inside plain data (a tool's input or result), keeping its
 * shape and keys, so a result still fits its tool's schema. Returns the same
 * value when nothing changed.
 */
export function maskDeep<T>(value: T, glyph = BAR, depth = 0): T {
  if (typeof value === 'string') return mask(value, glyph) as T
  if (value === null || typeof value !== 'object' || depth > 30) return value
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map(v => {
      const m = maskDeep(v, glyph, depth + 1)
      if (m !== v) changed = true
      return m
    })
    return (changed ? out : value) as T
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const entries = Object.entries(value as Record<string, unknown>)
  const hasEmail = entries.some(([k]) => EMAIL_KEY_RE.test(k))
  let changed = false
  const out: Record<string, unknown> = {}
  for (const [k, v] of entries) {
    let m: unknown
    // Ids are never private data and must reach the engine as they were.
    if (k === 'tool_use_id' || k === 'id') m = v
    else if (typeof v === 'string' && v && (NAME_KEY_RE.test(k) || (hasEmail && k === 'name'))) m = bar(v, glyph)
    else m = maskDeep(v, glyph, depth + 1)
    if (m !== v) changed = true
    out[k] = m
  }
  return (changed ? out : value) as T
}

// Run every rule once at load, so the first row drawn after /screen-share does
// not pay for building the patterns.
mask('From: Jane Doe <jane@x.co> (Bob Lee) | Ann Wu | +44 7700 900123, $4,250.00, "full_name": "A", {"name": "B", "email": "c"}')
cache.clear()
