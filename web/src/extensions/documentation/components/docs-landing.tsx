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
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Code2,
  Layers,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { DocumentationIndex } from '../types'
import { DocsSearch } from './docs-search'

const categoryIcons = [Zap, Layers, Terminal, Wrench, Code2, BookOpen]
const protocolNames = [
  'OpenAI Chat Completions',
  'OpenAI Responses',
  'Anthropic Messages',
  'Gemini',
]
const protocolPaths = [
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/messages',
  '/v1beta/models/{model}:generateContent',
]

export function DocsLanding(props: { index: DocumentationIndex }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const quickStart =
    props.index.articles.find((article) => article.slug === 'quick-start') ??
    props.index.articles[0]
  const protocols = props.index.articles.find(
    (article) => article.slug === 'protocols'
  )
  const faq = props.index.articles.filter(
    (article) => article.category_id === 'troubleshooting'
  )
  return (
    <div className='min-w-0 space-y-10 pb-12'>
      <header className='documentation-hero relative z-10 rounded-xl px-6 py-9 sm:px-9 sm:py-11'>
        <div className='relative z-1 max-w-2xl'>
          <Badge
            variant='outline'
            className='bg-card/70 text-primary mb-5 gap-1.5'
          >
            <BookOpen className='size-3' aria-hidden='true' />
            {t('Developer resources')}
          </Badge>
          <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>
            {props.index.title}
          </h1>
          <p className='text-muted-foreground mt-4 max-w-xl text-sm leading-7 sm:text-base'>
            {props.index.description}
          </p>
          <div className='mt-7 max-w-xl'>
            <DocsSearch />
          </div>
          {quickStart && (
            <Link
              to='/docs/guides/$slug'
              params={{ slug: quickStart.slug }}
              className='text-primary mt-5 inline-flex items-center gap-2 text-sm font-medium'
            >
              {t('Start with the quick guide')}
              <ArrowRight className='size-4' aria-hidden='true' />
            </Link>
          )}
        </div>
      </header>

      {props.index.articles.length === 0 && (
        <EmptyState
          icon={BookOpen}
          title={t('Documentation is being prepared')}
          description={t(
            'Published guides will appear here. Please check back soon.'
          )}
        />
      )}

      {props.index.categories.map((category, categoryIndex) => {
        const articles = props.index.articles.filter(
          (article) => article.category_id === category.id
        )
        if (!articles.length) return null
        const Icon = categoryIcons[categoryIndex % categoryIcons.length]
        return (
          <section
            key={category.id}
            aria-labelledby={`docs-category-${category.id}`}
          >
            <div className='mb-4 flex items-start gap-3'>
              <div className='bg-primary/8 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg'>
                <Icon aria-hidden='true' className='size-4' />
              </div>
              <div className='min-w-0 flex-1'>
                <h2
                  id={`docs-category-${category.id}`}
                  className='text-lg font-semibold'
                >
                  {category.title}
                </h2>
                <p className='text-muted-foreground mt-1 text-sm'>
                  {category.description}
                </p>
              </div>
              <span className='text-muted-foreground pt-2 text-xs'>
                {t('Guides: {{countText}}', {
                  countText: formatNumber(articles.length, locale),
                })}
              </span>
            </div>
            <div className='grid gap-3 md:grid-cols-2'>
              {articles.map((article) => (
                <Link
                  key={article.id}
                  to='/docs/guides/$slug'
                  params={{ slug: article.slug }}
                  className='bg-card hover:border-primary/40 group flex min-w-0 items-start gap-3 rounded-lg border p-5 transition-colors'
                >
                  <div className='min-w-0 flex-1'>
                    <h3 className='group-hover:text-primary text-sm font-semibold transition-colors'>
                      {article.title}
                    </h3>
                    <p className='text-muted-foreground mt-2 line-clamp-2 text-xs leading-6'>
                      {article.description}
                    </p>
                  </div>
                  <ArrowUpRight
                    aria-hidden='true'
                    className='text-muted-foreground group-hover:text-primary mt-0.5 size-4 shrink-0'
                  />
                </Link>
              ))}
            </div>
          </section>
        )
      })}

      {protocols && (
        <section
          aria-labelledby='docs-protocols'
          className='bg-card rounded-xl border p-5 sm:p-6'
        >
          <div className='flex items-center justify-between gap-4'>
            <h2 id='docs-protocols' className='text-lg font-semibold'>
              {t('One gateway, familiar API protocols')}
            </h2>
            <Code2 aria-hidden='true' className='text-primary size-5' />
          </div>
          <p className='text-muted-foreground mt-2 text-sm'>
            {t(
              'Use your existing SDK. Change the base URL and API key to get started.'
            )}
          </p>
          <div className='bg-muted/40 mt-5 flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2'>
            <code className='min-w-0 flex-1 overflow-x-auto text-xs'>
              {props.index.variables.api_base_url}
            </code>
            <CopyButton
              value={props.index.variables.api_base_url}
              aria-label={t('Copy API base URL')}
            />
          </div>
          <p className='text-muted-foreground mt-2 text-xs leading-5'>
            {t(
              'SDK base URL includes /v1. Endpoint paths below are relative to the site address.'
            )}
          </p>
          <div className='mt-5 grid gap-3 sm:grid-cols-2'>
            {protocolNames.map((name, index) => (
              <Link
                key={name}
                to='/docs/guides/$slug'
                params={{ slug: protocols.slug }}
                className='hover:border-primary/40 min-w-0 rounded-lg border p-4 transition-colors'
              >
                <h3 className='text-sm font-medium'>{name}</h3>
                <code className='text-muted-foreground mt-2 block overflow-x-auto text-[11px]'>
                  {protocolPaths[index]}
                </code>
              </Link>
            ))}
          </div>
        </section>
      )}
      {faq.length > 0 && (
        <section className='bg-card rounded-xl border p-6'>
          <h2 className='text-lg font-semibold'>{t('Need a hand?')}</h2>
          <p className='text-muted-foreground mt-2 text-sm'>
            {t(
              'Find answers to common connection, model access, and usage questions.'
            )}
          </p>
          <div className='mt-4 flex flex-wrap gap-4'>
            {faq.map((article) => (
              <Link
                className='text-primary inline-flex items-center gap-2 text-sm'
                key={article.id}
                to='/docs/guides/$slug'
                params={{ slug: article.slug }}
              >
                {article.title}
                <ArrowRight aria-hidden='true' className='size-4' />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
