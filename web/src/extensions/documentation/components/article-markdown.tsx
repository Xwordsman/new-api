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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CodeBlock } from '@/components/ai-elements/code-block'
import { CopyButton } from '@/components/copy-button'
import { Markdown } from '@/components/ui/markdown'

import { parseDocumentationMarkdown } from '../lib/markdown'

export function ArticleMarkdown(props: { content: string; baseUrl?: string }) {
  const { t } = useTranslation()
  const blocks = useMemo(
    () => parseDocumentationMarkdown(props.content),
    [props.content]
  )
  return (
    <div className='documentation-prose min-w-0 space-y-5 text-[15px] leading-7'>
      {blocks.map((block) => {
        if (block.type === 'code') {
          return (
            <CodeBlock
              key={block.key}
              code={block.text}
              language={block.language}
              showToolbar
              maxExpandedLines={32}
            >
              <CopyButton
                value={block.text}
                aria-label={t('Copy code')}
                tooltip={t('Copy code')}
              />
            </CodeBlock>
          )
        }
        if (block.type === 'heading') {
          return (
            <div id={block.id} key={block.key} className='scroll-mt-28 pt-4'>
              <Markdown baseUrl={props.baseUrl} className='text-[15px]'>
                {block.source}
              </Markdown>
            </div>
          )
        }
        return (
          <Markdown
            key={block.key}
            baseUrl={props.baseUrl}
            className='text-[15px] leading-7'
          >
            {block.source}
          </Markdown>
        )
      })}
    </div>
  )
}

export function ArticleTableOfContents(props: { content: string }) {
  const { t } = useTranslation()
  const headings = useMemo(
    () =>
      parseDocumentationMarkdown(props.content).filter(
        (block) => block.type === 'heading' && block.depth <= 3
      ),
    [props.content]
  )
  if (!headings.length) return null
  return (
    <nav aria-label={t('On this page')} className='border-l pl-5'>
      <h2 className='mb-4 text-xs font-semibold tracking-wide'>
        {t('On this page')}
      </h2>
      <ul className='space-y-3 text-xs leading-5'>
        {headings.map(
          (heading) =>
            heading.type === 'heading' && (
              <li
                key={heading.id}
                className={heading.depth === 3 ? 'pl-3' : undefined}
              >
                <a
                  className='text-muted-foreground hover:text-primary block transition-colors'
                  href={`#${heading.id}`}
                >
                  {heading.text}
                </a>
              </li>
            )
        )}
      </ul>
    </nav>
  )
}
