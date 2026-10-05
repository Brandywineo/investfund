export const KENYA_TIME_ZONE = 'Africa/Nairobi'

export function formatKenyaDateTime(
  value: Date | string,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
    timeZone: KENYA_TIME_ZONE,
  }).format(new Date(value))
}

export function kenyaDateKey(value: Date | string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KENYA_TIME_ZONE,
  }).format(new Date(value))
}
