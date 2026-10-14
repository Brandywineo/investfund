import { createFileRoute } from '@tanstack/react-router'
import { getSupportFileResponse } from '#/server/support-file.service'

export const Route = createFileRoute('/api/support-files/$messageId/$index')({
  server: {
    handlers: {
      GET: ({ params }) =>
        getSupportFileResponse(params.messageId, params.index),
    },
  },
})
