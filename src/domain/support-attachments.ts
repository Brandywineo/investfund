export const supportFileTypes = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
} as const
export type SupportAttachment = { name: string; mime: string; data: string }
export type SupportAttachmentInfo = { name: string; mime: string; size: number }
export const SUPPORT_FILE_LIMIT = 5_000_000
export const SUPPORT_FILE_COUNT = 5
export function supportFileMime(name: string): string | undefined {
  const extension = name.split('.').at(-1)?.toLowerCase()
  return supportFileTypes[extension as keyof typeof supportFileTypes]
}
export const supportFileAccept = Object.keys(supportFileTypes)
  .map((extension) => `.${extension}`)
  .join(',')
