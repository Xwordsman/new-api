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
import { Check, Layers, Minus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'

export function Comparison() {
  const { t } = useTranslation()
  const rows = [
    {
      title: t('Integration'),
      direct: t('Different endpoints and configurations for every provider.'),
      gateway: t('One base URL, compatible with familiar API routes.'),
    },
    {
      title: t('API key management'),
      direct: t('Manage separate credentials across multiple platforms.'),
      gateway: t('Manage your application keys from one console.'),
    },
    {
      title: t('Channel routing'),
      direct: t('Build your own channel selection and retry logic.'),
      gateway: t('Configure channels, groups and retries in one place.'),
    },
    {
      title: t('Usage visibility'),
      direct: t('Check separate dashboards to understand total usage.'),
      gateway: t('Review model usage and request costs together.'),
    },
  ]

  return (
    <section className='home-section home-comparison'>
      <div className='home-container'>
        <div className='home-section-heading-centered'>
          <Badge variant='outline' className='home-eyebrow'>
            <span className='home-badge-dot' aria-hidden />
            {t('A simpler connection')}
          </Badge>
          <h2 className='home-section-title'>
            {t('More models.')} <em>{t('Less complexity.')}</em>
          </h2>
          <p className='home-section-description'>
            {t(
              'Spend your time building products, not maintaining integrations.'
            )}
          </p>
        </div>
        <div
          className='home-comparison-scroll'
          tabIndex={0}
          role='region'
          aria-label={t('API integration comparison')}
        >
          <table className='home-comparison-table'>
            <thead>
              <tr>
                <td />
                <th scope='col'>{t('Connecting directly')}</th>
                <th scope='col'>
                  <Layers className='size-5' aria-hidden />
                  {t('One gateway with new-api')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.title}>
                  <th scope='row'>{row.title}</th>
                  <td>
                    <Minus className='size-4' aria-hidden />
                    <span>{row.direct}</span>
                  </td>
                  <td>
                    <Check className='size-4' aria-hidden />
                    <span>{row.gateway}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
