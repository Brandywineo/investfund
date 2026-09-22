import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import appCss from '../styles.css?url'
import { PwaRuntime } from '#/components/PwaRuntime'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { name: 'theme-color', content: '#123d2d' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      {
        title: 'InvestFund — Trading-led wealth platform',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icons/source.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/icons/icon-192.png' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <PwaRuntime />
        <Scripts />
      </body>
    </html>
  )
}
