# Private support screenshots

Admins can attach one PNG, JPEG or WebP screenshot of up to 1,000,000 bytes to a private support message. A text caption is required; include the capture time and remove sensitive account details. The composer shows a preview and lets the admin remove it before sending. Users see the image and caption in Help & Support and can open the full image in a new tab.

Images are stored with their message in PostgreSQL. Conversation responses contain only an image-presence flag. The image endpoint requires a session and verifies the conversation owner or ADMIN role on every request; unrelated users and managers receive 404. Responses are private/no-store with content-type sniffing disabled. SVG and other formats are rejected, and accepted MIME types must match their file signatures. The existing five-second send limit, notification bell and request retry protection also apply to image messages. User-side image uploads are not enabled in this release. No email is sent.

Deploy migration 0031_support_images.sql before restarting the app. Pull main, run bun install, bun run db:migrate and bun run build, then restart investfund.service. No signer, scanner, MT5 or email worker restart is needed. In Admin → Support inbox, select the user, choose a screenshot, write a caption, and Send message. Check Help & Support in the recipient account. Existing text messages remain unchanged.

Database integration coverage checks successful owner/admin retrieval, denied anonymous/unrelated/manager access, metadata-only history, MIME and size validation, non-admin upload rejection and conflicting attachment retries. For larger upload volumes, migrate attachment storage to private object storage.
