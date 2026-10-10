import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { getPublicSupportContact } from '#/server/support.functions'

const userPages = new Set([
  '/app',
  '/invest',
  '/wallet',
  '/referrals',
  '/trading',
  '/community',
  '/ledger',
  '/account',
  '/notifications',
  '/support',
])

export function SupportContact() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [contact, setContact] = useState<{
    email: string
    enabled: boolean
  } | null>(null)

  useEffect(() => {
    let active = true
    void getPublicSupportContact()
      .then((value) => {
        if (active) setContact(value)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  if (!userPages.has(pathname)) return null
  return (
    <div className="border-t border-black/5 bg-[#f4f6f2] px-5 py-5 text-center text-xs text-[#83958d] md:px-10">
      Need help?{' '}
      <Link to="/support" className="font-semibold text-[#557065] underline">
        Private support conversation
      </Link>
      {contact?.enabled && (
        <>
          {' '}
          ·
          <a
            className="font-semibold text-[#557065] underline decoration-black/15 underline-offset-4"
            href={`mailto:${contact.email}?subject=${encodeURIComponent('InvestFund Support')}`}
          >
            {contact.email}
          </a>
        </>
      )}
    </div>
  )
}
