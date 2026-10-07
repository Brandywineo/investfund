import { describe, expect, it } from 'vitest'
import {
  canModerateCommunity,
  communityImage,
  communityMessageInput,
} from './community'

describe('community access and attachments', () => {
  it('permits admin and assigned managers, rejects other managers and members', () => {
    const group = { managerUserId: 'assigned' }
    expect(canModerateCommunity({ id: 'admin', role: 'ADMIN' }, group)).toBe(
      true,
    )
    expect(
      canModerateCommunity({ id: 'assigned', role: 'MANAGER' }, group),
    ).toBe(true)
    expect(
      canModerateCommunity({ id: 'another', role: 'MANAGER' }, group),
    ).toBe(false)
    expect(canModerateCommunity({ id: 'assigned', role: 'USER' }, group)).toBe(
      false,
    )
  })
  it('rejects SVG, video, mismatched image content, oversize and empty messages', () => {
    for (const value of [
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:video/mp4;base64,AAAA',
      'data:image/png;base64,' +
        Buffer.from('not really an image').toString('base64'),
      'data:image/png;base64,' + Buffer.alloc(1000001).toString('base64'),
    ])
      expect(communityImage.safeParse(value).success).toBe(false)
    expect(
      communityMessageInput.safeParse({
        groupId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        body: '   ',
      }).success,
    ).toBe(false)
  })
  it('accepts a PNG with the correct MIME and file signature', () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII='
    expect(communityImage.safeParse(png).success).toBe(true)
  })
})
