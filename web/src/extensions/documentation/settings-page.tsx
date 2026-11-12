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
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'

import { documentationSettingsKey, getDocumentationSettings } from './api'
import { DocumentationSettingsForm } from './components/settings-form'

export function DocumentationSettingsPage() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: documentationSettingsKey,
    queryFn: getDocumentationSettings,
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={BookOpen}
        eyebrow='DOCUMENTATION'
        description={t(
          'Publish guides, API examples, and troubleshooting articles in one place.'
        )}
      >
        {t('Documentation center')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {query.isPending && <LoadingState />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
        {query.data && <DocumentationSettingsForm settings={query.data} />}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
