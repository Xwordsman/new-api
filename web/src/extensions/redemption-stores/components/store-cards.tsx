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
import { ExternalLink, Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'

import type { RedemptionStore } from '../types'

export function RedemptionStoreCards(props: { stores: RedemptionStore[] }) {
  const { t } = useTranslation()
  return (
    <section aria-label={t('Redemption stores')} className='space-y-3'>
      <div>
        <h3 className='text-sm font-semibold'>{t('Buy a redemption code')}</h3>
        <p className='text-muted-foreground mt-1 text-xs leading-5'>
          {t(
            'Choose a store, purchase a code, then enter it below to add funds to your account.'
          )}
        </p>
      </div>
      <div className='grid gap-3 sm:grid-cols-2'>
        {props.stores.map((store) => (
          <Card key={store.id} data-card-hover='false' className='gap-0 py-0'>
            <CardContent className='flex h-full min-w-0 flex-col gap-4 p-4'>
              <div className='flex items-start gap-3'>
                <IconBadge tone='primary'>
                  <Store aria-hidden='true' />
                </IconBadge>
                <div className='min-w-0'>
                  <h4 className='text-sm font-semibold break-words'>
                    {store.name}
                  </h4>
                  {store.description !== '' && (
                    <p className='text-muted-foreground mt-1 text-xs leading-5 break-words'>
                      {store.description}
                    </p>
                  )}
                </div>
              </div>
              <Button
                role='link'
                variant='outline'
                className='mt-auto w-full'
                aria-label={t('Visit {{store}}', { store: store.name })}
                render={
                  <a
                    href={store.url}
                    target='_blank'
                    rel='noopener noreferrer'
                  />
                }
              >
                {t('Visit store')}
                <ExternalLink aria-hidden='true' />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
