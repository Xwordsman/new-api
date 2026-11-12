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
import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { SettingsFormValues } from '../lib/schema'
import { SettingField } from './setting-field'

export function RulesEditor(props: { scope: 'users' | 'groups' | 'channels' }) {
  const { t, i18n } = useTranslation()
  const form = useFormContext<SettingsFormValues>()
  const rules = useFieldArray({ control: form.control, name: props.scope })
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <div className='space-y-4'>
      {rules.fields.length === 0 && (
        <p className='text-muted-foreground text-sm'>
          {t('No override rules. Default limits apply.')}
        </p>
      )}
      {rules.fields.map((rule, index) => (
        <fieldset
          key={rule.id}
          className='grid gap-4 rounded-lg border p-4 sm:grid-cols-2 xl:grid-cols-4'
        >
          <legend className='px-2 text-sm font-medium'>
            {t('Rule')} {formatNumber(index + 1, locale)}
          </legend>
          {props.scope === 'users' && (
            <SettingField
              name={`users.${index}.user_id`}
              label={t('User ID')}
              max={Number.MAX_SAFE_INTEGER}
            />
          )}
          {props.scope === 'groups' && (
            <SettingField
              name={`groups.${index}.group`}
              label={t('Account group')}
              kind='text'
            />
          )}
          {props.scope === 'channels' && (
            <SettingField
              name={`channels.${index}.channel_id`}
              label={t('Channel ID')}
              max={Number.MAX_SAFE_INTEGER}
            />
          )}
          <SettingField
            name={`${props.scope}.${index}.limit`}
            label={t('Concurrency limit')}
          />
          {props.scope === 'channels' && (
            <SettingField
              name={`channels.${index}.key_limit`}
              label={t('Per-credential concurrency limit')}
            />
          )}
          <Button
            type='button'
            variant='outline'
            className='self-end'
            onClick={() => rules.remove(index)}
          >
            {t('Remove rule')}
          </Button>
        </fieldset>
      ))}
      <Button
        type='button'
        variant='outline'
        disabled={rules.fields.length >= 200}
        onClick={() => {
          if (props.scope === 'users') {
            rules.append({ user_id: 0, limit: 5 })
          } else if (props.scope === 'groups') {
            rules.append({ group: '', limit: 5 })
          } else {
            rules.append({ channel_id: 0, limit: 0, key_limit: 0 })
          }
        }}
      >
        {t('Add rule')}
      </Button>
    </div>
  )
}
