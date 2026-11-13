/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Link } from '@tanstack/react-router'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import type { NavGroup } from '@/components/layout/types'
import { Badge } from '@/components/ui/badge'
import { useSidebarConfig } from '@/hooks/use-sidebar-config'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { getDocumentationLink } from '@/lib/documentation-link'
import { cn } from '@/lib/utils'

interface FooterLink {
  text: string
  href: string
  hash?: string
}

interface FooterColumnProps {
  title: string
  links: FooterLink[]
}

interface FooterProps {
  logo?: string
  name?: string
  columns?: FooterColumnProps[]
  copyright?: string
  className?: string
}

const NEW_API_FOOTER_ATTRIBUTION_KEY = [
  'footer',
  'new' + 'api',
  'projectAttributionSuffix',
].join('.')

const FOOTER_ACCOUNT_LINKS: NavGroup[] = [
  {
    title: 'Developer resources',
    items: [
      { title: 'API Keys', url: '/keys' },
      { title: 'Usage Logs', url: '/usage-logs' },
    ],
  },
  {
    title: 'Help and support',
    items: [
      { title: 'Wallet', url: '/wallet' },
      { title: 'Ticket center', url: '/tickets' },
    ],
  },
]

function FooterLinkItem(props: { link: FooterLink }) {
  const { t } = useTranslation()
  const isExternal = /^https?:\/\//i.test(props.link.href)
  const label = t(props.link.text)

  if (isExternal) {
    return (
      <a
        href={props.link.href}
        target='_blank'
        rel='noopener noreferrer'
        className='public-footer-link'
      >
        {label}
      </a>
    )
  }

  return (
    <Link
      to={props.link.href}
      hash={props.link.hash}
      className='public-footer-link'
    >
      {label}
    </Link>
  )
}

// Renders User Agreement / Privacy Policy links inline with the parent's
// copyright row when either is configured in System Settings → Site. Emits
// fragmented siblings so the parent flex container's gap controls spacing.
function LegalLinks(props: { leadingSeparator?: boolean }) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const items: { key: string; label: string; href: string }[] = []
  if (status?.user_agreement_enabled) {
    items.push({
      key: 'user-agreement',
      label: t('User Agreement'),
      href: '/user-agreement',
    })
  }
  if (status?.privacy_policy_enabled) {
    items.push({
      key: 'privacy-policy',
      label: t('Privacy Policy'),
      href: '/privacy-policy',
    })
  }
  if (items.length === 0) {
    return null
  }
  return (
    <>
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {(props.leadingSeparator || index > 0) && (
            <span aria-hidden='true' className='text-muted-foreground/30'>
              ·
            </span>
          )}
          <Link
            to={item.href}
            className='hover:text-foreground transition-colors duration-200'
          >
            {item.label}
          </Link>
        </Fragment>
      ))}
    </>
  )
}

// inline=true returns just the inner span for composition in a parent flex
// row. inline=false wraps in a centered/right-aligned div (default).
function ProjectAttribution(props: { currentYear: number; inline?: boolean }) {
  const { t } = useTranslation()
  const content = (
    <span className='text-muted-foreground/45'>
      &copy; {props.currentYear}{' '}
      <a
        href='https://github.com/QuantumNous/new-api'
        target='_blank'
        rel='noopener noreferrer'
        className='text-foreground/70 hover:text-foreground font-medium transition-colors'
      >
        {t('New API')}
      </a>
      . {t(NEW_API_FOOTER_ATTRIBUTION_KEY)}
    </span>
  )
  if (props.inline) {
    return content
  }
  return (
    <div className='text-muted-foreground/45 text-center text-xs sm:text-right'>
      {content}
    </div>
  )
}

export function Footer(props: FooterProps) {
  const { t } = useTranslation()
  const { systemName, logo: systemLogo, footerHtml } = useSystemConfig()
  const { status } = useStatus()
  const topLinks = useTopNavLinks()
  const accountGroups = useSidebarConfig(FOOTER_ACCOUNT_LINKS)
  const docsLink = getDocumentationLink(status)

  const displayLogo = systemLogo || props.logo || '/logo.png'
  const displayName = systemName || props.name || 'New API'
  const currentYear = new Date().getFullYear()

  const platformLinks = topLinks
    .filter((link) =>
      ['/pricing', '/rankings', '/dashboard'].includes(link.href)
    )
    .map((link) => ({ text: link.title, href: link.href }))
  const developerLinks: FooterLink[] = []
  if (docsLink && topLinks.some((link) => link.href === docsLink.href)) {
    developerLinks.push({
      text: t('Documentation center'),
      href: docsLink.href,
    })
  }
  const supportLinks: FooterLink[] = [
    { text: t('FAQ'), href: '/', hash: 'faq' },
  ]
  for (const group of accountGroups) {
    const links = group.items.flatMap((item) =>
      item.url ? [{ text: t(item.title), href: item.url }] : []
    )
    if (group.title === 'Developer resources') developerLinks.push(...links)
    else supportLinks.push(...links)
  }
  if (topLinks.some((link) => link.href === '/about')) {
    supportLinks.push({ text: t('About'), href: '/about' })
  }
  const displayColumns = props.columns ?? [
    { title: t('Platform'), links: platformLinks },
    { title: t('Developer resources'), links: developerLinks },
    { title: t('Help and support'), links: supportLinks },
  ]

  if (footerHtml) {
    return (
      <footer
        className={cn('bg-card relative z-10 w-full border-t', props.className)}
      >
        <div className='w-full px-5 py-6 sm:px-8 lg:px-12'>
          <div className='bg-muted/20 border-border/50 flex flex-col items-center justify-between gap-4 rounded-2xl border px-4 py-4 backdrop-blur-sm sm:flex-row sm:px-5'>
            <div
              className='custom-footer text-muted-foreground min-w-0 text-center text-sm sm:text-left'
              dangerouslySetInnerHTML={{ __html: footerHtml }}
            />
            <div className='border-border/60 text-muted-foreground/45 flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t pt-4 text-xs sm:w-auto sm:justify-end sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5'>
              <LegalLinks />
              <ProjectAttribution currentYear={currentYear} inline />
            </div>
          </div>
        </div>
      </footer>
    )
  }

  return (
    <footer
      className={cn(
        'public-footer relative z-10 w-full border-t',
        props.className
      )}
    >
      <div className='relative w-full px-5 pt-14 pb-6 sm:px-6 lg:px-8 lg:pt-16'>
        <div className='grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-16'>
          <div className='min-w-0'>
            <Link
              to='/'
              className='public-footer-brand inline-flex max-w-full items-center gap-3 rounded-md'
            >
              <img
                src={displayLogo}
                alt=''
                className='size-9 shrink-0 rounded-lg object-contain'
              />
              <span className='truncate text-xl font-semibold tracking-tight'>
                {displayName}
              </span>
            </Link>
            <p className='mt-6 text-2xl font-semibold tracking-tight sm:text-3xl'>
              {t('One connection. More possibilities.')}
            </p>
            <p className='text-muted-foreground mt-3 max-w-sm text-sm leading-7'>
              {t('Your models, tools and usage, connected in one place.')}
            </p>
            <p className='text-muted-foreground mt-1 text-xs leading-6'>
              {t('Powerful API Management Platform')}
            </p>
            <div className='text-primary mt-6 flex flex-wrap gap-3 text-xs'>
              <Badge
                variant='outline'
                className='border-primary/15 bg-primary/5 text-primary h-auto rounded-md px-3 py-2'
              >
                {t('Multi-protocol Compatible')}
              </Badge>
              <Badge
                variant='outline'
                className='border-primary/15 bg-primary/5 text-primary h-auto rounded-md px-3 py-2'
              >
                {t('Pay-as-you-go')}
              </Badge>
            </div>
          </div>

          <nav
            aria-label={t('Footer navigation')}
            className='grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-3 sm:gap-x-10'
          >
            {displayColumns
              .filter((column) => column.links.length > 0)
              .map((column) => (
                <div key={column.title} className='min-w-0'>
                  <h2 className='text-foreground mb-5 flex items-center gap-2.5 text-sm font-semibold'>
                    <span
                      className='bg-primary/60 h-3 w-0.5 rounded-full'
                      aria-hidden
                    />
                    {t(column.title)}
                  </h2>
                  <ul className='flex flex-col gap-3.5'>
                    {column.links.map((link) => (
                      <li key={`${link.href}-${link.text}`}>
                        <FooterLinkItem link={link} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </nav>
        </div>

        <div className='mt-12 border-t pt-5 lg:mt-16'>
          <div className='flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between'>
            <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-2 text-xs leading-6'>
              <span>
                &copy; {currentYear} {displayName}.{' '}
                {props.copyright ?? t('footer.defaultCopyright')}
              </span>
              <LegalLinks leadingSeparator />
            </div>
            <ProjectAttribution currentYear={currentYear} />
          </div>
        </div>
      </div>
    </footer>
  )
}
