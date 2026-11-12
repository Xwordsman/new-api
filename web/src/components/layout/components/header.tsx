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
import { useTranslation } from 'react-i18next'

import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useLayout } from '@/context/layout-provider'
import { cn } from '@/lib/utils'

type HeaderProps = React.HTMLAttributes<HTMLElement>

export function Header({ className, children, ...props }: HeaderProps) {
  const { t } = useTranslation()
  const { collapsible } = useLayout()
  const { isMobile, openMobile, open } = useSidebar()
  const showMenuTrigger =
    collapsible !== 'none' && (isMobile || collapsible === 'offcanvas')
  let menuLabel = t('Toggle navigation menu')
  if (isMobile) menuLabel = openMobile ? t('Close menu') : t('Open menu')

  return (
    <header
      className={cn(
        'bg-card sticky top-0 z-40 h-[var(--app-header-height)] w-full shrink-0 border-b',
        className
      )}
      {...props}
    >
      <div className='flex h-full items-center gap-1 px-4 sm:gap-3 sm:px-6 lg:px-8'>
        {children}
        {showMenuTrigger && (
          <SidebarTrigger
            className='text-muted-foreground size-8'
            aria-label={menuLabel}
            title={menuLabel}
            aria-expanded={isMobile ? openMobile : open}
          />
        )}
      </div>
    </header>
  )
}
