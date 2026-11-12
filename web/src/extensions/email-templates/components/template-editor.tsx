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
import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CodeBlockEditor } from '@/components/ai-elements/code-block'
import {
  WebPreview,
  WebPreviewBody,
} from '@/components/ai-elements/web-preview'
import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { previewEmailTemplate } from '../api'
import type { EmailTemplate, TemplateDefinition } from '../types'

export function TemplateEditor(props: {
  template: EmailTemplate
  definition: TemplateDefinition
  onChange: (template: EmailTemplate) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const preview = useMutation({ mutationFn: previewEmailTemplate })
  const upToDate =
    preview.data &&
    preview.variables?.type === props.template.type &&
    preview.variables?.language === props.template.language &&
    preview.variables?.subject === props.template.subject &&
    preview.variables?.html === props.template.html
  // The first CSP is outside edited HTML. The empty sandbox also prevents
  // scripts, same-origin access, navigation, forms and popups in the preview.
  const previewDocument = preview.data
    ? `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"></head><body>${preview.data.html}</body></html>`
    : undefined

  return (
    <div className='space-y-5'>
      <div className='space-y-2'>
        <Label htmlFor='email-template-subject'>{t('Email subject')}</Label>
        <Input
          id='email-template-subject'
          value={props.template.subject}
          maxLength={240}
          onChange={(event) =>
            props.onChange({ ...props.template, subject: event.target.value })
          }
          disabled={props.disabled}
        />
        <p className='text-muted-foreground text-xs'>
          {t(
            'Subjects support site_name and original_subject only. HTML supports the variables below.'
          )}
        </p>
      </div>
      <div className='grid min-w-0 gap-5 2xl:grid-cols-2'>
        <div className='min-w-0' inert={props.disabled}>
          <CodeBlockEditor
            ariaLabel={t('Email HTML source')}
            autoFocus={false}
            language='html'
            rows={24}
            title={t('Email HTML source')}
            value={props.template.html}
            onChange={(html) => props.onChange({ ...props.template, html })}
          />
        </div>
        <div className='flex min-w-0 flex-col overflow-hidden rounded-lg border'>
          <div className='flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3'>
            <span className='text-sm font-medium'>{t('Email preview')}</span>
            <Button
              type='button'
              variant='outline'
              disabled={props.disabled || preview.isPending}
              onClick={() => preview.mutate(props.template)}
            >
              <Eye aria-hidden='true' />
              {preview.isPending ? t('Loading...') : t('Update preview')}
            </Button>
          </div>
          <p className='text-muted-foreground border-b px-4 py-2.5 text-xs leading-relaxed'>
            {t(
              'Preview uses sample data only. No email is sent and no real verification code is issued.'
            )}
          </p>
          {preview.isError && (
            <Alert variant='destructive' className='m-3 w-auto'>
              <AlertDescription>
                {t('Preview failed. Check the template and try again.')}
              </AlertDescription>
            </Alert>
          )}
          {preview.data && (
            <div
              className='space-y-1 border-b px-4 py-3 text-sm'
              aria-live='polite'
            >
              <p className='break-words'>{preview.data.subject}</p>
              {!upToDate && (
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'The template changed. Update the preview to see your latest edits.'
                  )}
                </p>
              )}
            </div>
          )}
          {previewDocument ? (
            <WebPreview className='min-h-[580px] flex-1 rounded-none border-0'>
              <WebPreviewBody
                className='min-h-[580px] bg-white'
                srcDoc={previewDocument}
                sandbox=''
                referrerPolicy='no-referrer'
                title={t('Email preview')}
              />
            </WebPreview>
          ) : (
            <EmptyState
              icon={Eye}
              title={t('Preview your email')}
              description={t(
                'Choose Update preview to render this template with safe sample data.'
              )}
              className='min-h-[420px] flex-1 border-0'
            />
          )}
        </div>
      </div>
      <div className='space-y-3'>
        <h3 className='text-sm font-semibold'>{t('Available variables')}</h3>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Copy variables with double braces. Keep all required variables; notification content is inserted automatically.'
          )}
        </p>
        <div className='grid gap-2 md:grid-cols-2 xl:grid-cols-3'>
          {props.definition.variables.map((variable) => (
            <div
              key={variable.name}
              className='flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5'
            >
              <div className='min-w-0 flex-1 space-y-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <code className='text-xs break-all'>{`{{${variable.name}}}`}</code>
                  {variable.required && (
                    <Badge variant='secondary'>{t('Required')}</Badge>
                  )}
                </div>
                <p className='text-muted-foreground text-xs'>
                  {t(variable.description)}
                </p>
              </div>
              <CopyButton
                value={`{{${variable.name}}}`}
                tooltip={t('Copy variable')}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
