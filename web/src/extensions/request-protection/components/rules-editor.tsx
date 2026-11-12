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
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

import type { ProtectionForm } from '../lib/schema'
import { PolicyField } from './policy-field'

export function RulesEditor(props: { disabled: boolean }) {
  const { t } = useTranslation()
  const form = useFormContext<ProtectionForm>()
  const rules = useFieldArray({
    control: form.control,
    name: 'rules',
    keyName: 'fieldKey',
  })
  const sources = [
    { value: 'current', label: t('Current input') },
    { value: 'system', label: t('System instructions') },
    { value: 'history', label: t('Conversation history') },
    { value: 'tool', label: t('Tool output') },
  ] as const
  return (
    <section className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h3 className='font-semibold'>{t('Detection rules')}</h3>
        <Button
          type='button'
          variant='outline'
          disabled={props.disabled || rules.fields.length >= 100}
          onClick={() =>
            rules.append({
              id: `rule-${crypto.randomUUID().slice(0, 8)}`,
              name: t('New detection rule'),
              enabled: true,
              kind: 'all',
              patterns: '',
              sources: ['current'],
              action: 'observe',
              high_confidence: false,
              count_penalty: false,
            })
          }
        >
          {t('Add rule')}
        </Button>
      </div>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Example rules only observe. Test rules before enabling blocking. Text is normalized for case, whitespace, full-width and zero-width characters. Regex uses Go RE2 against normalized text.'
        )}
      </p>
      {(form.formState.errors.rules?.root?.message ||
        form.formState.errors.rules?.message) && (
        <p role='alert' className='text-destructive text-sm'>
          {t(
            form.formState.errors.rules.root?.message ||
              form.formState.errors.rules.message ||
              ''
          )}
        </p>
      )}
      {rules.fields.map((rule, index) => (
        <Collapsible key={rule.fieldKey} className='rounded-lg border'>
          <CollapsibleTrigger className='flex w-full items-center justify-between gap-4 px-4 py-3 text-left font-medium'>
            <RuleName index={index} />
            <span aria-hidden='true'>⌄</span>
          </CollapsibleTrigger>
          <CollapsibleContent className='space-y-5 border-t p-4'>
            <div className='grid gap-5 sm:grid-cols-2'>
              <PolicyField
                name={`rules.${index}.id`}
                label={t('Rule ID')}
                disabled={props.disabled}
              />
              <PolicyField
                name={`rules.${index}.name`}
                label={t('Rule name')}
                disabled={props.disabled}
              />
              <PolicyField
                name={`rules.${index}.enabled`}
                label={t('Enable rule')}
                kind='switch'
                disabled={props.disabled}
              />
              <PolicyField
                name={`rules.${index}.kind`}
                label={t('Matching method')}
                options={[
                  { value: 'any', label: t('Any pattern') },
                  { value: 'all', label: t('All patterns in the same source') },
                  { value: 'regex', label: t('Any regular expression') },
                ]}
                disabled={props.disabled}
              />
            </div>
            <PolicyField
              name={`rules.${index}.patterns`}
              label={t('Patterns, one per line')}
              kind='lines'
              disabled={props.disabled}
            />
            <FormField
              control={form.control}
              name={`rules.${index}.sources`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Inspect these sources')}</FormLabel>
                  <div className='flex flex-wrap gap-5'>
                    {sources.map((source) => (
                      <label
                        key={source.value}
                        className='flex items-center gap-2 text-sm'
                      >
                        <Checkbox
                          checked={field.value.includes(source.value)}
                          onCheckedChange={(checked) =>
                            field.onChange(
                              checked
                                ? [...field.value, source.value]
                                : field.value.filter(
                                    (value) => value !== source.value
                                  )
                            )
                          }
                          disabled={props.disabled}
                        />
                        {source.label}
                      </label>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid gap-5 sm:grid-cols-2'>
              <PolicyField
                name={`rules.${index}.action`}
                label={t('Rule action')}
                options={[
                  { value: 'observe', label: t('Record only') },
                  { value: 'block', label: t('Block') },
                ]}
                disabled={props.disabled}
              />
              <PolicyField
                name={`rules.${index}.high_confidence`}
                label={t('High-confidence rule')}
                kind='switch'
                disabled={props.disabled}
              />
              <PolicyField
                name={`rules.${index}.count_penalty`}
                label={t('Count toward temporary restrictions')}
                kind='switch'
                description={t(
                  'Requires a high-confidence blocking rule. Review false positives to remove their scores.'
                )}
                disabled={props.disabled}
              />
            </div>
            <Button
              type='button'
              variant='destructive'
              disabled={props.disabled}
              onClick={() => rules.remove(index)}
            >
              {t('Remove rule')}
            </Button>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </section>
  )
}

function RuleName(props: { index: number }) {
  const form = useFormContext<ProtectionForm>()
  const { t } = useTranslation()
  const name = useWatch({
    control: form.control,
    name: `rules.${props.index}.name`,
  })
  return (
    <span className='min-w-0 break-words'>
      {name || t('New detection rule')}
    </span>
  )
}
