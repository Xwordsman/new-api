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
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { MultiSelect } from '@/components/multi-select'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

import { getChannels } from '../api'
import type { ProtectionForm } from '../lib/schema'
import { PolicyField } from './policy-field'

export function ProtectionControls(props: { disabled: boolean }) {
  const { t } = useTranslation()
  const form = useFormContext<ProtectionForm>()
  const reviewer = useWatch({ control: form.control, name: 'reviewer' })
  const query = useQuery({
    queryKey: ['request-protection', 'channels'],
    queryFn: getChannels,
  })
  const channels = query.data ?? []
  const selected = channels.find(
    (channel) => channel.id === reviewer.channel_id
  )
  const reviewModels = selected?.models.split(',').filter(Boolean) ?? []
  if (reviewer.model && !reviewModels.includes(reviewer.model)) {
    reviewModels.push(reviewer.model)
  }
  return (
    <div className='space-y-6'>
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      <FormField
        control={form.control}
        name='channel_ids'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Protected channels')}</FormLabel>
            <FormControl>
              <MultiSelect
                options={channels.map((channel) => ({
                  value: String(channel.id),
                  label: `${channel.name} (#${channel.id})`,
                }))}
                selected={field.value.map(String)}
                onChange={(values) => field.onChange(values.map(Number))}
                disabled={props.disabled || query.isPending}
              />
            </FormControl>
            <FormDescription>
              {t(
                'Leave empty to protect all business channels. Groups are never suspended.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <section className='space-y-3'>
        <h3 className='font-semibold'>{t('Risk categories')}</h3>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Semantic review checks intent and context. Greetings, ordinary code, security education and medical discussion are allowed.'
          )}
        </p>
        <div className='grid gap-3 sm:grid-cols-2'>
          <PolicyField
            name='categories.jailbreak'
            label={t('Jailbreak and safety bypass')}
            kind='switch'
            disabled={props.disabled}
          />
          <PolicyField
            name='categories.theft'
            label={t('Credential theft and malicious cracking')}
            kind='switch'
            disabled={props.disabled}
          />
          <PolicyField
            name='categories.attack'
            label={t('Malicious cyberattacks')}
            kind='switch'
            disabled={props.disabled}
          />
          <PolicyField
            name='categories.sexual'
            label={t('Pornography and sexual exploitation')}
            kind='switch'
            disabled={props.disabled}
          />
        </div>
      </section>
      <section className='space-y-4 rounded-lg border p-4'>
        <PolicyField
          name='reviewer.enabled'
          label={t('Enable semantic review')}
          kind='switch'
          disabled={props.disabled}
          description={t(
            'Reviews every scoped text request before forwarding. Select a separate OpenAI-compatible channel with one key, on a different provider host. Review requests incur provider cost and latency. Without semantic review, only custom local rules run.'
          )}
        />
        <div className='grid gap-5 sm:grid-cols-2'>
          <PolicyField
            name='reviewer.channel_id'
            label={t('Review channel')}
            kind='number'
            options={[
              { value: '0', label: t('Select a separate review channel') },
              ...channels
                .filter((channel) => channel.type === 1)
                .map((channel) => ({
                  value: String(channel.id),
                  label: `${channel.name} (#${channel.id})`,
                })),
            ]}
            disabled={props.disabled || !reviewer.enabled}
          />
          <PolicyField
            name='reviewer.model'
            label={t('Review model')}
            options={[
              { value: '', label: t('Select a review model') },
              ...reviewModels.map((model) => ({ value: model, label: model })),
            ]}
            disabled={props.disabled || !reviewer.enabled}
          />
        </div>
      </section>
      <section className='space-y-4'>
        <h3 className='font-semibold'>{t('Request handling')}</h3>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Enforcement blocks a clear violation immediately. Uncertain or failed reviews never add violation penalties. Account suspension requires a separate action.'
          )}
        </p>
        <PolicyField
          name='reviewer.failure_action'
          label={t('When review is uncertain or unavailable')}
          options={[
            { value: 'block', label: t('Reject this request for review') },
            { value: 'observe', label: t('Record and allow this request') },
          ]}
          disabled={props.disabled}
        />
      </section>
    </div>
  )
}
