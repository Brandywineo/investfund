export const DEFAULT_BUSINESS_TIMEZONE = 'Africa/Nairobi'

export function businessDateKey(at: Date, timeZone = DEFAULT_BUSINESS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function accrualDateFromKey(key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Invalid business date')
  return new Date(`${key}T00:00:00.000Z`)
}
