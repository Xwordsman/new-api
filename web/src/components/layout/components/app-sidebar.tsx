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
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { useLayout } from '@/context/layout-provider'
import { useSidebarView } from '@/hooks/use-sidebar-view'
import { MOTION_TRANSITION, MOTION_VARIANTS } from '@/lib/motion'

import { NavGroup } from './nav-group'
import { SidebarViewHeader } from './sidebar-view-header'

/**
 * Application sidebar.
 *
 * Adopts the Vercel / Cloudflare "drill-in" pattern: the URL drives
 * which sidebar *view* is rendered. Clicking a top-level entry like
 * `System Settings` swaps the sidebar to a contextual workspace —
 * with a `← Back to Dashboard` affordance — instead of stacking the
 * sub-navigation inside the root tree.
 *
 * Architecture:
 *   - View resolution + filtering: {@link useSidebarView}
 *   - View registry: `layout/lib/sidebar-view-registry.ts`
 *   - Per-view header: {@link SidebarViewHeader}
 *
 * Adding a new nested view only requires registering a {@link SidebarView}
 * in the registry; this component requires no changes.
 */
export function AppSidebar() {
  const { t } = useTranslation()
  const { collapsible, variant } = useLayout()
  const { isMobile, openMobile, open } = useSidebar()
  const { key, view, navGroups } = useSidebarView()
  const shouldReduce = useReducedMotion()
  let menuLabel = open ? t('Collapse') : t('Expand')
  if (isMobile) menuLabel = t('Close menu')

  return (
    <Sidebar
      collapsible={collapsible}
      variant={variant}
      className='app-sidebar'
    >
      {view && <SidebarViewHeader view={view} />}

      <SidebarContent className='py-4'>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key={key}
            initial={
              shouldReduce ? false : MOTION_VARIANTS.sidebarSlide.initial
            }
            animate={MOTION_VARIANTS.sidebarSlide.animate}
            exit={shouldReduce ? undefined : MOTION_VARIANTS.sidebarSlide.exit}
            transition={MOTION_TRANSITION.fast}
            className='flex flex-col'
          >
            {navGroups.map((props) => (
              <NavGroup key={props.id || props.title} {...props} />
            ))}
          </motion.div>
        </AnimatePresence>
      </SidebarContent>

      {collapsible !== 'none' && (
        <SidebarFooter className='border-sidebar-border items-end border-t px-1.5 py-2 group-data-[collapsible=icon]:items-center'>
          <SidebarTrigger
            className='text-muted-foreground size-8'
            aria-label={menuLabel}
            title={menuLabel}
            aria-expanded={isMobile ? openMobile : open}
          />
        </SidebarFooter>
      )}
      <SidebarRail
        aria-label={t('Toggle navigation menu')}
        title={t('Toggle navigation menu')}
      />
    </Sidebar>
  )
}
