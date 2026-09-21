import { createFileRoute, redirect } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    throw redirect({ to: (await currentUser()) ? '/app' : '/login' })
  },
})
