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

import type { SettingsFormValues } from '../lib/schema'
import { SettingField } from './setting-field'

export function RulesEditor() {
  const { t } = useTranslation()
  const form = useFormContext<SettingsFormValues>()
  const rules = useFieldArray({
    control: form.control,
    name: 'rules',
    keyName: 'fieldKey',
  })
  const actions = [
    ['observe', t('Observe only')],
    ['review', t('Hold rewards for review')],
    ['deny', t('Deny registration')],
  ] as const
  return (
    <div className='space-y-4'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Rules count attempts in shared fixed windows across gateway nodes. The strongest matching action wins. Cookie and network matches are weak signals; prefer review for shared networks.'
        )}
      </p>
      {rules.fields.map((rule, index) => (
        <fieldset
          key={rule.fieldKey}
          className='grid gap-4 rounded-lg border p-4 sm:grid-cols-2 xl:grid-cols-3'
        >
          <legend className='px-2 text-sm font-medium'>
            {t('Rule')} {index + 1}
          </legend>
          <SettingField
            name={`rules.${index}.id`}
            label={t('Rule identifier')}
          />
          <SettingField
            name={`rules.${index}.enabled`}
            label={t('Enabled')}
            kind='toggle'
          />
          <SettingField
            name={`rules.${index}.stage`}
            label={t('Registration stage')}
            options={[
              ['email', t('Send verification email')],
              ['register', t('Create account')],
            ]}
          />
          <SettingField
            name={`rules.${index}.signal`}
            label={t('Risk signal')}
            options={[
              ['email', t('Email')],
              ['ip', t('IP address')],
              ['network', t('Network prefix')],
              ['device', t('Browser cookie')],
              ['inviter', t('Inviter')],
              ['global', t('All requests')],
            ]}
          />
          <SettingField
            name={`rules.${index}.window_seconds`}
            label={t('Counting window (seconds)')}
            kind='number'
          />
          <SettingField
            name={`rules.${index}.limit`}
            label={t('Allowed attempts per window')}
            kind='number'
          />
          <SettingField
            name={`rules.${index}.action`}
            label={t('Action after limit')}
            options={actions}
          />
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
      {!!form.formState.errors.rules && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Check rule identifiers, limits and actions')}
        </p>
      )}
      <Button
        type='button'
        variant='outline'
        disabled={rules.fields.length >= 50}
        onClick={() =>
          rules.append({
            id: `rule-${crypto.randomUUID().slice(0, 8)}`,
            enabled: true,
            stage: 'register',
            signal: 'device',
            window_seconds: 86400,
            limit: 2,
            action: 'review',
          })
        }
      >
        {t('Add rule')}
      </Button>
    </div>
  )
}
