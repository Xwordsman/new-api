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
import { useMutation } from '@tanstack/react-query'
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getDefaultKeywords } from '../api'
import { lines, type ProtectionForm } from '../lib/schema'
import { PolicyField } from './policy-field'

export function KeywordControls(props: { disabled: boolean }) {
  const { t, i18n } = useTranslation()
  const form = useFormContext<ProtectionForm>()
  const keywords = useWatch({ control: form.control, name: 'keywords' })
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const restore = useMutation({
    mutationFn: getDefaultKeywords,
    onSuccess: (defaults) => {
      form.setValue(
        'keywords',
        {
          ...defaults,
          block: defaults.block.join('\n'),
          suspend: defaults.suspend.join('\n'),
        },
        { shouldDirty: true, shouldValidate: true }
      )
    },
  })
  return (
    <section className='space-y-4 border-t pt-5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h3 className='font-semibold'>{t('Moderation keywords')}</h3>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={props.disabled || restore.isPending}
          onClick={() => restore.mutate()}
        >
          {t('Restore built-in keywords')}
        </Button>
      </div>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Built-in library: 119 original terms, 229 supplementary terms and 22 combination rules. Edit one keyword per line; changes take effect after saving.'
        )}
      </p>
      <PolicyField
        name='keywords.enabled'
        label={t('Enable keyword screening')}
        kind='switch'
        disabled={props.disabled}
      />
      <div className='grid gap-5 lg:grid-cols-2'>
        <PolicyField
          name='keywords.block'
          label={t('Blocking keywords')}
          kind='lines'
          disabled={props.disabled}
          description={t('Matching blocks the request. Entries: {{count}}', {
            count: formatNumber(lines(keywords.block).length, locale),
          })}
        />
        <PolicyField
          name='keywords.suspend'
          label={t('Immediate-suspension keywords')}
          kind='lines'
          disabled={props.disabled}
          description={t(
            'Matching blocks the request and pauses the user if automatic suspension is enabled. Entries: {{count}}',
            { count: formatNumber(lines(keywords.suspend).length, locale) }
          )}
        />
      </div>
      <PolicyField
        name='keywords.combinations'
        label={t('Enable combination rules')}
        kind='switch'
        disabled={props.disabled}
        description={t(
          'Requires multiple terms in the same sentence of the latest user input. Conversation history and tool output do not trigger keyword penalties.'
        )}
      />
      <p className='text-muted-foreground text-sm'>
        {t(
          'Original terms can also match quotations, medical or legal discussion. Review the saved request before confirming misconduct.'
        )}
      </p>
    </section>
  )
}
