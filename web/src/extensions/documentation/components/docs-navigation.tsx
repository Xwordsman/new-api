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
import { BookOpen, ChevronRight, Menu } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { DocumentationIndex } from '../types'

export function DocsNavigation(props: {
  index: DocumentationIndex
  slug?: string
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('Documentation navigation')} className='space-y-6'>
      <Link
        to='/docs'
        onClick={props.onNavigate}
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          !props.slug
            ? 'bg-primary/8 text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
        aria-current={!props.slug ? 'page' : undefined}
      >
        <BookOpen aria-hidden='true' className='size-4' />
        {t('Documentation overview')}
      </Link>
      {props.index.categories.map((category) => {
        const articles = props.index.articles.filter(
          (article) => article.category_id === category.id
        )
        if (!articles.length) return null
        return (
          <div key={category.id}>
            <h2 className='text-muted-foreground mb-2 px-3 text-[11px] font-semibold tracking-wide'>
              {category.title}
            </h2>
            <ul className='space-y-0.5'>
              {articles.map((article) => (
                <li key={article.id}>
                  <Link
                    to='/docs/guides/$slug'
                    params={{ slug: article.slug }}
                    onClick={props.onNavigate}
                    aria-current={
                      props.slug === article.slug ? 'page' : undefined
                    }
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] leading-5 transition-colors',
                      props.slug === article.slug
                        ? 'bg-primary/8 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                  >
                    <span>{article.title}</span>
                    {props.slug === article.slug && (
                      <ChevronRight
                        aria-hidden='true'
                        className='size-3 shrink-0'
                      />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      <a
        href='/llms-full.txt'
        target='_blank'
        rel='noopener noreferrer'
        className='text-muted-foreground hover:text-primary block border-t px-3 pt-4 text-xs'
      >
        {t('Full documentation for AI')} ↗
      </a>
    </nav>
  )
}

export function MobileDocsNavigation(props: {
  index: DocumentationIndex
  slug?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className='lg:hidden'>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Documentation navigation')}
        trigger={
          <Button variant='outline' className='h-10 w-full justify-start'>
            <Menu aria-hidden='true' />
            {t('Browse documentation')}
          </Button>
        }
        contentClassName='max-w-sm'
        bodyClassName='max-h-[70vh]'
      >
        <DocsNavigation {...props} onNavigate={() => setOpen(false)} />
      </Dialog>
    </div>
  )
}
