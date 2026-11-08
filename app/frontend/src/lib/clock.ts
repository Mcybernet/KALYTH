/**
 * Wall-clock reading for the coin's reverse face.
 *
 * The dial shows the visitor's local time. The zone comes from an IP
 * geolocation lookup first (so a clock opened in Jakarta reads WIB even when
 * the device itself is set to UTC), and falls back to the device time zone
 * when the lookup is blocked or offline.
 *
 * Only the resolved IANA zone name is kept — cached for a few hours in
 * `sessionStorage` so the lookup runs once per tab. The IP itself is never
 * stored. Lookups are `credentials: 'omit'` and time out after 4s.
 */

const CACHE_KEY = 'klyth:timezone'
const CACHE_TTL = 6 * 60 * 60 * 1000
const LOOKUP_TIMEOUT = 4000
const OFFSET_TTL = 15000

type CachedZone = { timeZone: string; at: number }

export type ClockReading = {
  /** Fractional hour of the 12-hour dial, `0`–`12`. */
  hours: number
  /** Fractional minute, `0`–`60`. */
  minutes: number
  /** Fractional second, `0`–`60`. */
  seconds: number
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return false
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Safe nested property read so provider payloads can stay untyped. */
function nested(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function readCache(): string | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as CachedZone
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > CACHE_TTL) {
      return null
    }
    return isValidTimeZone(parsed.timeZone) ? parsed.timeZone : null
  } catch {
    return null
  }
}

function writeCache(timeZone: string): void {
  try {
    const entry: CachedZone = { timeZone, at: Date.now() }
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Private mode or storage disabled — the lookup simply runs again later.
  }
}

async function lookup(
  url: string,
  pick: (payload: unknown) => unknown,
): Promise<string | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), LOOKUP_TIMEOUT)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok) {
      return null
    }
    const zone = pick(await response.json())
    return isValidTimeZone(zone) ? zone : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

const providers: Array<{ url: string; pick: (payload: unknown) => unknown }> = [
  { url: 'https://ipwho.is/', pick: (payload) => nested(payload, 'timezone', 'id') },
  {
    url: 'https://get.geojs.io/v1/ip/geo.json',
    pick: (payload) => nested(payload, 'timezone'),
  },
]

/**
 * Resolve the visitor's time zone from their IP address.
 *
 * Never rejects: on any failure it resolves to the device zone.
 */
export async function resolveVisitorTimeZone(): Promise<string> {
  const cached = readCache()
  if (cached) {
    return cached
  }
  for (const provider of providers) {
    const zone = await lookup(provider.url, provider.pick)
    if (zone) {
      writeCache(zone)
      return zone
    }
  }
  return deviceTimeZone()
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone)
  if (existing) {
    return existing
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  formatters.set(timeZone, formatter)
  return formatter
}

const offsets = new Map<string, { value: number; at: number }>()

/** Milliseconds the zone is ahead of UTC at `at`, including DST. */
export function zoneOffsetMs(timeZone: string, at: number): number {
  const cached = offsets.get(timeZone)
  if (cached && Math.abs(at - cached.at) < OFFSET_TTL) {
    return cached.value
  }

  let offset = 0
  try {
    const fields: Record<string, number> = {}
    for (const part of formatterFor(timeZone).formatToParts(new Date(at))) {
      if (part.type !== 'literal') {
        fields[part.type] = Number(part.value)
      }
    }
    const asUtc = Date.UTC(
      fields.year,
      fields.month - 1,
      fields.day,
      fields.hour % 24,
      fields.minute,
      fields.second,
    )
    offset = Number.isFinite(asUtc) ? asUtc - Math.floor(at / 1000) * 1000 : 0
  } catch {
    offset = 0
  }

  offsets.set(timeZone, { value: offset, at })
  return offset
}

/** Dial angles for the given zone, keeping sub-second precision for a sweep. */
export function readClock(timeZone: string, at: number = Date.now()): ClockReading {
  const local = (at + zoneOffsetMs(timeZone, at)) / 1000
  return {
    seconds: local % 60,
    minutes: (local / 60) % 60,
    hours: (local / 3600) % 12,
  }
}
