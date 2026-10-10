import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { SupportConversation } from '#/components/SupportConversation'

export const Route = createFileRoute('/support')({
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: '/login' })
  },
  component: SupportPage,
})
function SupportPage() {
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c]">
      <div className="mx-auto max-w-3xl">
        <Link to="/app" className="text-sm font-bold">
          ← Dashboard
        </Link>
        <h1 className="mb-2 mt-5 text-4xl font-semibold">Help &amp; Support</h1>
        <p className="mb-6 text-sm text-[#557065]">
          Contact the InvestFund team directly. Replies are from administrators;
          this is not an automated chat.
        </p>
        <SupportConversation />
      </div>
    </main>
  )
}
