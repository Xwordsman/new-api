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
import { ArrowUpRight, FileText, Search, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { useDebounce } from '@/hooks/use-debounce'

import { documentationKey, searchDocumentation } from '../api'

export function DocsSearch() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsId = useId()
  const tooManyTerms = input.trim().split(/\s+/).length > 10
  const query = useDebounce(input.trim(), 300)
  const search = useQuery({
    queryKey: [...documentationKey, 'search', query],
    queryFn: ({ signal }) => searchDocumentation(query, signal),
    enabled: Boolean(query) && !tooManyTerms && query.split(/\s+/).length <= 10,
    meta: { errorToast: false },
  })
  return (
    <div
      className='relative z-10 w-full'
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          inputRef.current?.focus()
          setDismissed(true)
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setDismissed(true)
        }
      }}
    >
      <InputGroup className='bg-card h-11 rounded-lg shadow-xs'>
        <InputGroupAddon className='pl-3'>
          <Search aria-hidden='true' className='size-4' />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          aria-label={t('Search documentation')}
          aria-controls={input.trim() && !dismissed ? resultsId : undefined}
          aria-invalid={tooManyTerms}
          placeholder={t('Search guides, tools, or API questions...')}
          maxLength={120}
          value={input}
          onFocus={() => setDismissed(false)}
          onChange={(event) => {
            setInput(event.target.value)
            setDismissed(false)
          }}
        />
        {input && (
          <InputGroupAddon align='inline-end'>
            <InputGroupButton
              aria-label={t('Clear search')}
              onClick={() => setInput('')}
            >
              <X aria-hidden='true' />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      {input.trim() && !dismissed && (
        <section
          id={resultsId}
          aria-label={t('Documentation search results')}
          aria-live='polite'
          className='bg-card absolute top-13 left-0 max-h-[60vh] w-full overflow-y-auto rounded-lg border p-2 shadow-lg'
        >
          {tooManyTerms && (
            <p className='text-muted-foreground p-3 text-sm'>
              {t('Use up to 10 search terms.')}
            </p>
          )}
          {!tooManyTerms && (input.trim() !== query || search.isPending) && (
            <LoadingState
              className='min-h-24'
              message={t('Searching documentation...')}
            />
          )}
          {!tooManyTerms && input.trim() === query && search.isError && (
            <ErrorState
              className='min-h-32'
              title={t('Search is temporarily unavailable')}
              onRetry={() => void search.refetch()}
            />
          )}
          {!tooManyTerms &&
            input.trim() === query &&
            search.isSuccess &&
            search.data.length === 0 && (
              <EmptyState
                className='min-h-32'
                icon={Search}
                title={t('No matching articles')}
                description={t(
                  'Try a tool name, protocol, or a shorter search term.'
                )}
              />
            )}
          {!tooManyTerms &&
            input.trim() === query &&
            search.isSuccess &&
            search.data.map((article) => (
              <Link
                key={article.id}
                to='/docs/guides/$slug'
                params={{ slug: article.slug }}
                onClick={() => setInput('')}
                className='hover:bg-primary/5 group flex items-start gap-3 rounded-md p-3 transition-colors'
              >
                <FileText
                  aria-hidden='true'
                  className='text-primary mt-1 size-4 shrink-0'
                />
                <div className='min-w-0 flex-1'>
                  <p className='text-sm font-semibold'>{article.title}</p>
                  <p className='text-muted-foreground mt-1 line-clamp-2 text-xs leading-5'>
                    {article.excerpt || article.description}
                  </p>
                </div>
                <ArrowUpRight
                  aria-hidden='true'
                  className='text-muted-foreground mt-1 size-4 shrink-0'
                />
              </Link>
            ))}
        </section>
      )}
    </div>
  )
}
