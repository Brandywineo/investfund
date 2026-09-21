import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { runAccrualBatch } from './accrual.service'
import { getSessionUser } from './session'

export const runDailyAccruals = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      businessDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await getSessionUser()
    if (!admin || admin.role !== 'ADMIN')
      throw new Error('Administrator access required')
    return runAccrualBatch({
      businessDate: data.businessDate,
      actorUserId: admin.id,
    })
  })
