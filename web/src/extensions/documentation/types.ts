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
export type DocumentationCategory = {
  id: string
  title: string
  description: string
  sort_order: number
}

export type DocumentationArticle = {
  id: string
  category_id: string
  slug: string
  title: string
  description: string
  content: string
  status: 'draft' | 'published'
  sort_order: number
  updated_at: number
}

export type DocumentationMetadata = Omit<DocumentationArticle, 'content'>

export type DocumentationSettings = {
  revision: number
  enabled: boolean
  title: string
  description: string
  categories: DocumentationCategory[]
  articles: DocumentationArticle[]
}

export type DocumentationVariables = {
  site_name: string
  site_url: string
  api_base_url: string
}

export type DocumentationIndex = {
  title: string
  description: string
  categories: DocumentationCategory[]
  articles: DocumentationMetadata[]
  variables: DocumentationVariables
}

export type DocumentationDetail = {
  article: DocumentationArticle
  previous: DocumentationMetadata | null
  next: DocumentationMetadata | null
  variables: DocumentationVariables
}

export type DocumentationSearchResult = DocumentationMetadata & {
  excerpt: string
}
