import { z } from 'zod'
import {
  SUPPORT_FILE_LIMIT,
  supportFileMime,
} from '#/domain/support-attachments'

// Examine ZIP directory entries without extracting or decompressing uploaded files.
function officeDirectory(bytes: Buffer, required: string): boolean {
  const start = Math.max(0, bytes.length - 65557)
  let end = -1
  for (let i = bytes.length - 22; i >= start; i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    return false
  const count = bytes.readUInt16LE(end + 10)
  let offset = bytes.readUInt32LE(end + 16)
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      return false
    if (bytes.readUInt16LE(offset + 8) & 1) return false
    const length = bytes.readUInt16LE(offset + 28)
    const next =
      offset +
      46 +
      length +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32)
    if (next > end) return false
    names.push(bytes.toString('utf8', offset + 46, offset + 46 + length))
    offset = next
  }
  return (
    names.includes('[Content_Types].xml') &&
    names.includes(required) &&
    !names.some((name) => /vbaProject\.bin$/i.test(name))
  )
}
export const supportAttachmentInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine(
        (name) =>
          !Array.from(name).some(
            (character) =>
              character.charCodeAt(0) < 32 ||
              character.charCodeAt(0) === 127 ||
              character === '/' ||
              character === '\\',
          ),
        'Use a plain filename',
      ),
    mime: z.string().max(120),
    data: z.string().min(4).max(6_666_668),
  })
  .refine((file) => {
    if (
      supportFileMime(file.name) !== file.mime ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)
    )
      return false
    const bytes = Buffer.from(file.data, 'base64')
    if (
      !bytes.length ||
      bytes.length > SUPPORT_FILE_LIMIT ||
      bytes.toString('base64') !== file.data
    )
      return false
    if (file.mime === 'image/png')
      return (
        bytes.length >= 12 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
    if (file.mime === 'image/jpeg')
      return (
        bytes.length >= 12 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255
      )
    if (file.mime === 'image/webp')
      return (
        bytes.length >= 12 &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP'
      )
    if (file.mime === 'application/pdf')
      return bytes.toString('ascii', 0, 5) === '%PDF-'
    if (file.mime.includes('wordprocessingml'))
      return officeDirectory(bytes, 'word/document.xml')
    if (file.mime.includes('spreadsheetml'))
      return officeDirectory(bytes, 'xl/workbook.xml')
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return !bytes.includes(0)
    } catch {
      return false
    }
  }, 'Use a supported file up to 5 MB with matching filename and content')
