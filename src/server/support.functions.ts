import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { getDb } from '#/db'
import { platformSettings } from '#/db/schema'

export const getPublicSupportContact = createServerFn({
  method: 'GET',
}).handler(async () => {
  const settings = await getDb()
    .select({
      email: platformSettings.supportEmail,
      enabled: platformSettings.supportEmailEnabled,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
  return settings ?? { email: 'support@investfund.site', enabled: true }
})
