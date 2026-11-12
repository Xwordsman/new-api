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
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type ConsolePageHeaderProps = {
  title: ReactNode
  icon: LucideIcon
  eyebrow: string
  description: ReactNode
  actions?: ReactNode
  breadcrumb?: ReactNode
  children?: ReactNode
  stackActionsOnMobile?: boolean
  variant?: 'card' | 'ambient'
}

export function ConsolePageHeader(props: ConsolePageHeaderProps) {
  const Icon = props.icon
  const ambient = props.variant !== 'card'

  return (
    <header
      className={cn(
        'shrink-0 px-4 pt-5 pb-4 sm:px-6 sm:pt-7 sm:pb-5 lg:px-8',
        ambient && 'px-2 pt-2 sm:px-2 sm:pt-2 lg:px-2'
      )}
    >
      {props.breadcrumb != null && (
        <div className={cn('mb-3', ambient && 'px-2 sm:px-4 lg:px-6')}>
          {props.breadcrumb}
        </div>
      )}
      <Card
        data-card-hover='false'
        data-console-surface='false'
        className={cn(
          'py-4 sm:py-5',
          ambient &&
            'console-page-header-ambient relative isolate border-0 bg-transparent py-5 shadow-none ring-0 sm:py-5'
        )}
      >
        <CardContent
          className={cn(
            'relative z-1 flex flex-col gap-4 sm:px-5',
            ambient && 'px-2 sm:px-4 lg:px-6'
          )}
        >
          <div className='flex flex-wrap items-center justify-between gap-4'>
            <div
              data-slot='console-page-introduction'
              className={cn(
                'flex min-w-0 basis-80 grow gap-3 sm:gap-4',
                ambient ? 'items-center' : 'items-start',
                props.stackActionsOnMobile && 'max-sm:basis-full'
              )}
            >
              <div className='bg-primary/8 text-primary flex size-11 shrink-0 items-center justify-center rounded-lg'>
                <Icon className='size-5' aria-hidden='true' />
              </div>
              <div className='flex min-w-0 flex-col gap-1'>
                <p
                  lang='en'
                  className='text-primary text-[10px] leading-4 font-semibold tracking-[0.16em] uppercase'
                >
                  {props.eyebrow}
                </p>
                <h1 className='text-xl leading-snug font-semibold tracking-tight sm:text-2xl'>
                  {props.title}
                </h1>
                <p className='text-muted-foreground text-sm leading-6'>
                  {props.description}
                </p>
              </div>
            </div>
            {props.actions != null && (
              <div className='flex max-w-full flex-wrap items-center gap-2 sm:ml-auto sm:justify-end'>
                {props.actions}
              </div>
            )}
          </div>
          {props.children}
        </CardContent>
      </Card>
    </header>
  )
}
