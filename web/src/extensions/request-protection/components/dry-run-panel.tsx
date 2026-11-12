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
import { useId, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { JsonCodeEditor } from '@/components/json-code-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { dryRun } from '../api'
import { toSettings, type ProtectionForm } from '../lib/schema'
import { ProtectionLabel } from './record-label'

export function DryRunPanel(props: { disabled: boolean }) {
  const { t } = useTranslation()
  const form = useFormContext<ProtectionForm>()
  const id = useId()
  const [input, setInput] = useState({
    model: 'gpt-4.1',
    group: 'default',
    protocol: 'openai',
    body: '{\n  "messages": [{"role": "user", "content": "Hello"}]\n}',
  })
  const run = useMutation({ mutationFn: dryRun })
  const disabled = props.disabled || run.isPending
  return (
    <section
      data-console-tone='info'
      className='console-surface bg-card space-y-5 rounded-xl border p-5 sm:p-6'
    >
      <h3 className='font-semibold'>{t('Test current policy')}</h3>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Test unsaved settings without calling an upstream, storing an event or adding penalties. Enable protection in the form to test the selected scope.'
        )}
      </p>
      <div className='grid gap-4 sm:grid-cols-3'>
        {[
          { name: 'model', label: t('Model') },
          { name: 'group', label: t('Group') },
          { name: 'protocol', label: t('Protocol') },
        ].map((field) => (
          <div className='space-y-2' key={field.name}>
            <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
            <Input
              id={`${id}-${field.name}`}
              value={input[field.name as 'model' | 'group' | 'protocol']}
              maxLength={field.name === 'protocol' ? 40 : 191}
              onChange={(event) => {
                setInput({ ...input, [field.name]: event.target.value })
                run.reset()
              }}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
      <Label htmlFor={`${id}-body`}>{t('Sample request body')}</Label>
      <JsonCodeEditor
        id={`${id}-body`}
        ariaLabel={t('Sample request body')}
        value={input.body}
        onChange={(body) => {
          setInput({ ...input, body })
          run.reset()
        }}
        disabled={disabled}
      />
      <Button
        type='button'
        disabled={disabled}
        onClick={async () => {
          run.reset()
          if (await form.trigger()) {
            run.mutate({ ...input, settings: toSettings(form.getValues()) })
          }
        }}
      >
        {t('Run local test')}
      </Button>
      {run.isError && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Local test failed. Check the policy and request, then retry.')}
        </p>
      )}
      {run.data && (
        <div role='status' className='space-y-3 rounded-lg border p-4'>
          <h4 className='font-medium'>{t('Last local test result')}</h4>
          <p>
            {t('Decision')}: <ProtectionLabel value={run.data.decision} />
          </p>
          <p>
            {t('Eligible for violation counting')}:{' '}
            {run.data.eligible ? t('Yes') : t('No')}
          </p>
          {run.data.uninspected && (
            <p>
              {t('Incomplete inspection')}:{' '}
              <ProtectionLabel value={run.data.uninspected} />
            </p>
          )}
          {run.data.hits.length === 0 && <p>{t('No rules matched')}</p>}
          {run.data.hits.map((hit) => (
            <p key={`${hit.rule_id}-${hit.source}`} className='break-words'>
              {hit.name} ({hit.rule_id}) ·{' '}
              <ProtectionLabel value={hit.source} /> ·{' '}
              <ProtectionLabel value={hit.action} />
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
