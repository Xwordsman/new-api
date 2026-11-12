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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'

import { HeaderLogo } from './header-logo'

type SystemBrandProps = {
  defaultName?: string
  defaultVersion?: string
  name?: string
  logo?: ReactNode
  homeUrl?: string
  /**
   * Visual layout:
   * - 'sidebar': stacked card style (used inside the sidebar header).
   * - 'inline': shared public and console header branding.
   */
  variant?: 'sidebar' | 'inline'
}

/**
 * System brand component
 * Displays current system logo + name.
 * - inline: shared header branding with a link to home
 * - sidebar: stacked card in the sidebar header (display only)
 */
export function SystemBrand(props: SystemBrandProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { systemName, logo, loading, logoLoaded } = useSystemConfig()

  const variant = props.variant ?? 'sidebar'
  const name =
    props.name || status?.system_name || props.defaultName || systemName
  const version =
    status?.version || props.defaultVersion || t('Unknown version')

  if (variant === 'inline') {
    return (
      <Link
        to={props.homeUrl ?? '/'}
        aria-label={t('Go to home')}
        className='group text-foreground focus-visible:ring-ring/40 inline-flex min-w-0 items-center gap-2.5 rounded-md outline-none select-none focus-visible:ring-2'
      >
        <div className='flex size-7 shrink-0 items-center justify-center transition-transform duration-300 group-hover:scale-105'>
          {loading ? (
            <Skeleton className='size-full rounded-lg' />
          ) : (
            props.logo || (
              <HeaderLogo
                src={logo}
                alt={t('Logo')}
                loading={loading}
                logoLoaded={logoLoaded}
                className='size-full rounded-lg object-contain'
              />
            )
          )}
        </div>
        <span
          className='max-w-48 truncate text-base font-semibold tracking-tight'
          title={name}
        >
          {loading ? <Skeleton className='h-4 w-16' /> : name}
        </span>
      </Link>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size='lg'
          className='hover:text-sidebar-foreground active:text-sidebar-foreground cursor-default hover:bg-transparent active:bg-transparent'
          render={<div />}
        >
          <div className='flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg'>
            <img
              src={logo}
              alt={t('Logo')}
              className='size-full rounded-lg object-cover'
            />
          </div>
          <div className='grid flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden'>
            <span className='truncate font-semibold'>{name}</span>
            <span className='truncate text-xs'>{version}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
