import { createFileRoute } from '@tanstack/react-router'
import { getCommunityImageResponse } from '#/server/community-image.service'

export const Route = createFileRoute('/api/community-images/$messageId')({
  server: {
    handlers: {
      GET: ({ params }) => getCommunityImageResponse(params.messageId),
    },
  },
})
