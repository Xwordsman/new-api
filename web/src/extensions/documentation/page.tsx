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
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'

import { documentationKey, getDocumentation } from './api'
import { DocsArticle } from './components/docs-article'
import { DocsLanding } from './components/docs-landing'
import {
  DocsNavigation,
  MobileDocsNavigation,
} from './components/docs-navigation'

export function DocumentationPage(props: { slug?: string }) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: [...documentationKey, 'index'],
    queryFn: getDocumentation,
    retry: false,
    meta: { errorToast: false },
  })
  return (
    <PublicLayout showMainContainer={false}>
      <main className='documentation-page mx-auto min-h-[70vh] max-w-[1540px] px-4 pt-[calc(var(--app-header-height)+1.5rem)] sm:px-6 lg:px-8'>
        {query.isPending && <LoadingState />}
        {query.isError && (
          <ErrorState
            icon={BookOpen}
            title={t('Documentation is unavailable')}
            description={t(
              'The documentation center is not enabled or could not be loaded.'
            )}
            onRetry={() => void query.refetch()}
            action={
              <Button render={<Link to='/' />} variant='outline'>
                {t('Back to home')}
              </Button>
            }
          />
        )}
        {!query.isError && query.data && (
          <div className='grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-9'>
            <aside className='sticky top-24 hidden max-h-[calc(100dvh-7rem)] self-start overflow-y-auto border-r pr-5 pb-8 lg:block'>
              <DocsNavigation index={query.data} slug={props.slug} />
            </aside>
            <div className='min-w-0 space-y-5'>
              <MobileDocsNavigation index={query.data} slug={props.slug} />
              {props.slug ? (
                <DocsArticle
                  key={props.slug}
                  index={query.data}
                  slug={props.slug}
                />
              ) : (
                <DocsLanding index={query.data} />
              )}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </PublicLayout>
  )
}
