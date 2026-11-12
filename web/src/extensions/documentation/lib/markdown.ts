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
import { marked } from 'marked'

type ArticleBlock =
  | { type: 'markdown'; key: string; source: string }
  | {
      type: 'heading'
      key: string
      source: string
      id: string
      text: string
      depth: number
    }
  | { type: 'code'; key: string; text: string; language: string }

export function parseDocumentationMarkdown(source: string): ArticleBlock[] {
  const tokens = marked.lexer(source)
  // Preserve reference-style links when rendering independent prose sections.
  const definitions = Object.entries(tokens.links)
    .map(
      ([id, link]) =>
        `[${id}]: <${link.href}>${link.title ? ` "${link.title.replaceAll('"', '&quot;')}"` : ''}`
    )
    .join('\n')
  const blocks: ArticleBlock[] = []
  let headings = 0
  let offset = 0
  for (const token of tokens) {
    const key = `${token.type}-${offset}`
    offset += token.raw.length
    if (token.type === 'heading') {
      headings += 1
      blocks.push({
        type: 'heading',
        key,
        source: `${token.raw}\n\n${definitions}`,
        id: `section-${headings}`,
        text: token.text.replaceAll(/<[^>]*>/g, '').replaceAll(/[*_`]/g, ''),
        depth: token.depth,
      })
    } else if (
      token.type === 'code' &&
      !['mermaid', 'flow', 'flowchart', 'sequence'].includes(token.lang ?? '')
    ) {
      blocks.push({
        type: 'code',
        key,
        text: token.text,
        language: token.lang?.split(/\s/)[0] || 'plaintext',
      })
    } else {
      const previous = blocks.at(-1)
      if (previous?.type === 'markdown') previous.source += token.raw
      else blocks.push({ type: 'markdown', key, source: token.raw })
    }
  }
  return blocks.map((block) =>
    block.type === 'markdown'
      ? { ...block, source: `${block.source}\n\n${definitions}` }
      : block
  )
}
