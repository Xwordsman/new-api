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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, Clock, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'

import {
  documentationDownloadUrl,
  documentationKey,
  getDocumentationArticle,
} from '../api'
import type { DocumentationIndex } from '../types'
import { ArticleMarkdown, ArticleTableOfContents } from './article-markdown'
import { DocsSearch } from './docs-search'

export function DocsArticle(props: {
  slug: string
  index: DocumentationIndex
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useQuery({
    queryKey: [...documentationKey, 'article', props.slug],
    queryFn: () => getDocumentationArticle(props.slug),
    retry: false,
    meta: { errorToast: false },
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) {
    return (
      <ErrorState
        title={t('This guide is unavailable')}
        description={t(
          'It may have been moved or unpublished. Browse the documentation to find another guide.'
        )}
        onRetry={() => void query.refetch()}
        action={
          <Button render={<Link to='/docs' />} variant='outline'>
            {t('Back to documentation')}
          </Button>
        }
      />
    )
  }
  const article = query.data.article
  const category = props.index.categories.find(
    (item) => item.id === article.category_id
  )
  return (
    <div className='grid min-w-0 gap-10 xl:grid-cols-[minmax(0,1fr)_200px]'>
      <article className='min-w-0 pb-12'>
        <div className='mb-7 max-w-xl'>
          <DocsSearch />
        </div>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to='/docs' />}>
                {t('Documentation center')}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {category?.title ?? article.title}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <header className='mt-7 border-b pb-7'>
          <h1 className='text-3xl leading-tight font-semibold tracking-tight sm:text-4xl'>
            {article.title}
          </h1>
          <p className='text-muted-foreground mt-4 text-[15px] leading-7'>
            {article.description}
          </p>
          <div className='mt-5 flex flex-wrap items-center justify-between gap-3'>
            <span className='text-muted-foreground inline-flex items-center gap-1.5 text-xs'>
              <Clock aria-hidden='true' className='size-3.5' />
              {t('Last updated')}:{' '}
              {article.updated_at > 0
                ? new Intl.DateTimeFormat(locale, {
                    dateStyle: 'medium',
                  }).format(new Date(article.updated_at * 1000))
                : '—'}
            </span>
            <div className='flex flex-wrap gap-2'>
              <CopyButton
                value={article.content}
                variant='outline'
                size='sm'
                aria-label={t('Copy Markdown')}
              >
                {t('Copy Markdown')}
              </CopyButton>
              <Button
                size='sm'
                variant='outline'
                render={
                  <a
                    href={documentationDownloadUrl(article.slug)}
                    download={`${article.slug}.md`}
                  />
                }
              >
                <Download aria-hidden='true' />
                {t('Download Markdown')}
              </Button>
            </div>
          </div>
        </header>
        <div className='my-6 xl:hidden'>
          <ArticleTableOfContents content={article.content} />
        </div>
        <div className='mt-6'>
          <ArticleMarkdown
            content={article.content}
            baseUrl={`${query.data.variables.site_url}/docs/guides/${encodeURIComponent(article.slug)}`}
          />
        </div>
        <nav
          aria-label={t('Adjacent guides')}
          className='mt-12 grid gap-3 border-t pt-6 sm:grid-cols-2'
        >
          {query.data.previous ? (
            <Link
              to='/docs/guides/$slug'
              params={{ slug: query.data.previous.slug }}
              className='bg-card hover:border-primary/40 rounded-lg border p-4 transition-colors'
            >
              <span className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                <ArrowLeft className='size-3' aria-hidden='true' />
                {t('Previous guide')}
              </span>
              <span className='mt-2 block text-sm font-medium'>
                {query.data.previous.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {query.data.next && (
            <Link
              to='/docs/guides/$slug'
              params={{ slug: query.data.next.slug }}
              className='bg-card hover:border-primary/40 rounded-lg border p-4 text-right transition-colors'
            >
              <span className='text-muted-foreground flex items-center justify-end gap-1.5 text-xs'>
                {t('Next guide')}
                <ArrowRight className='size-3' aria-hidden='true' />
              </span>
              <span className='mt-2 block text-sm font-medium'>
                {query.data.next.title}
              </span>
            </Link>
          )}
        </nav>
      </article>
      <aside className='sticky top-25 hidden max-h-[calc(100dvh-8rem)] self-start overflow-y-auto xl:block'>
        <ArticleTableOfContents content={article.content} />
      </aside>
    </div>
  )
}
