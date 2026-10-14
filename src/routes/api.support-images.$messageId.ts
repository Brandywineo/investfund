import { createFileRoute } from '@tanstack/react-router'
import { getSupportImageResponse } from '#/server/support-image.service'

export const Route = createFileRoute('/api/support-images/$messageId')({
  server: {
    handlers: {
      GET: ({ params }) => getSupportImageResponse(params.messageId),
    },
  },
})
