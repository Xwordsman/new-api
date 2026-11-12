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
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { EmailTemplateSettingsPage } from '../settings-page'
import type {
  EmailTemplateConfiguration,
  EmailTemplateSettings,
} from '../types'

const configuration: EmailTemplateConfiguration = {
  settings: { revision: 4, enabled: false, templates: [] },
  catalog: [
    {
      type: 'verification',
      name: 'Registration verification',
      variables: [
        {
          name: 'verification_code',
          description: 'Verification code',
          required: true,
        },
      ],
      defaults: {
        'zh-CN': {
          type: 'verification',
          language: 'zh-CN',
          subject: '验证 {{site_name}}',
          html: '<p>{{verification_code}}</p>',
        },
        'zh-TW': {
          type: 'verification',
          language: 'zh-TW',
          subject: '驗證 {{site_name}}',
          html: '<p>{{verification_code}}</p>',
        },
        en: {
          type: 'verification',
          language: 'en',
          subject: 'Verify {{site_name}}',
          html: '<p>{{verification_code}}</p>',
        },
      },
    },
    {
      type: 'security_notice',
      name: 'Account security notice',
      variables: [
        {
          name: 'content',
          description: 'Original notification content',
          required: true,
        },
      ],
      defaults: {
        'zh-CN': {
          type: 'security_notice',
          language: 'zh-CN',
          subject: '安全提醒',
          html: '<p>{{content}}</p>',
        },
        'zh-TW': {
          type: 'security_notice',
          language: 'zh-TW',
          subject: '安全提醒',
          html: '<p>{{content}}</p>',
        },
        en: {
          type: 'security_notice',
          language: 'en',
          subject: 'Security notice',
          html: '<p>{{content}}</p>',
        },
      },
    },
  ],
}
let client: QueryClient

beforeEach(() => {
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
})

afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

function renderSettings(current = configuration) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: current },
  })
  render(
    <QueryClientProvider client={client}>
      <EmailTemplateSettingsPage />
    </QueryClientProvider>
  )
}

it('keeps drafts when changing email types and languages and saves only changed templates', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => ({
    data: {
      success: true,
      data: { ...(body as EmailTemplateSettings), revision: 5 },
    },
  }))
  renderSettings()
  let subject = await screen.findByRole('textbox', { name: 'Email subject' })
  await user.clear(subject)
  await user.type(subject, '我的验证码')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Email language' }),
    'en'
  )
  subject = screen.getByRole('textbox', { name: 'Email subject' })
  expect(subject).toHaveValue('Verify {{site_name}}')
  await user.clear(subject)
  await user.type(subject, 'My code')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Email type' }),
    'security_notice'
  )
  expect(screen.getByRole('textbox', { name: 'Email subject' })).toHaveValue(
    'Security notice'
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Email type' }),
    'verification'
  )
  expect(screen.getByRole('textbox', { name: 'Email subject' })).toHaveValue(
    'My code'
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Email language' }),
    'zh-CN'
  )
  expect(screen.getByRole('textbox', { name: 'Email subject' })).toHaveValue(
    '我的验证码'
  )
  const enabled = screen.getByRole('switch', { name: 'Enable email templates' })
  act(() => enabled.focus())
  await user.keyboard(' ')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledExactlyOnceWith(
      '/api/extensions/email-templates/admin/settings',
      {
        revision: 4,
        enabled: true,
        templates: [
          {
            ...configuration.catalog[0].defaults['zh-CN'],
            subject: '我的验证码',
          },
          { ...configuration.catalog[0].defaults.en, subject: 'My code' },
        ],
      }
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  )
})

it('restores only the selected type and language after confirmation and requires an explicit save', async () => {
  const user = userEvent.setup()
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: {} } })
  renderSettings({
    ...configuration,
    settings: {
      revision: 4,
      enabled: false,
      templates: [
        {
          ...configuration.catalog[0].defaults['zh-CN'],
          subject: 'Custom Chinese',
        },
        { ...configuration.catalog[0].defaults.en, subject: 'Custom English' },
      ],
    },
  })
  const subject = await screen.findByRole('textbox', { name: 'Email subject' })
  await user.click(
    screen.getByRole('button', { name: 'Restore this template' })
  )
  expect(
    screen.getByRole('alertdialog', { name: 'Restore this template?' })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Restore default' }))
  expect(subject).toHaveValue('验证 {{site_name}}')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Email language' }),
    'en'
  )
  expect(screen.getByRole('textbox', { name: 'Email subject' })).toHaveValue(
    'Custom English'
  )
  expect(put).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
})

it('previews unsaved templates while disabled with sample data inside an isolated frame', async () => {
  const user = userEvent.setup()
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        subject: 'Preview subject',
        html: '<html><head></head><body><p>482916</p></body></html>',
      },
    },
  })
  renderSettings()
  const subject = await screen.findByRole('textbox', { name: 'Email subject' })
  await user.clear(subject)
  await user.type(subject, 'Unsaved draft')
  await user.click(screen.getByRole('button', { name: 'Update preview' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledExactlyOnceWith(
      '/api/extensions/email-templates/admin/preview',
      {
        ...configuration.catalog[0].defaults['zh-CN'],
        subject: 'Unsaved draft',
      }
    )
  )
  const preview = await screen.findByTitle('Email preview')
  expect(preview).toHaveAttribute('sandbox', '')
  expect(preview).toHaveAttribute('referrerpolicy', 'no-referrer')
  expect(preview.getAttribute('srcdoc')).toContain('Content-Security-Policy')
  expect(preview.getAttribute('srcdoc')).toContain("default-src 'none'")
  expect(preview.getAttribute('srcdoc')).toContain('482916')
  expect(screen.getByText('Preview subject')).toBeVisible()
  await user.type(subject, ' changed')
  expect(
    screen.getByText(
      'The template changed. Update the preview to see your latest edits.'
    )
  ).toBeVisible()
  expect(
    screen.getByRole('switch', { name: 'Enable email templates' })
  ).not.toBeChecked()
  post.mockResolvedValueOnce({
    data: { success: false, message: 'Invalid email template settings' },
  })
  await user.click(screen.getByRole('button', { name: 'Update preview' }))
  expect(
    await screen.findByText('Preview failed. Check the template and try again.')
  ).toBeVisible()
  expect(subject).toHaveValue('Unsaved draft changed')
})

it('keeps drafts after a conflicting save and reloads newer saved settings only when requested', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message: 'Email templates changed. Reload before saving.',
    },
  })
  renderSettings()
  const subject = await screen.findByRole('textbox', { name: 'Email subject' })
  await user.clear(subject)
  await user.type(subject, 'Local draft')
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        ...configuration,
        settings: {
          revision: 5,
          enabled: true,
          templates: [
            {
              ...configuration.catalog[0].defaults['zh-CN'],
              subject: 'New saved subject',
            },
          ],
        },
      },
    },
  })
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  const reload = await screen.findByRole('button', {
    name: 'Reload saved settings',
  })
  expect(subject).toHaveValue('Local draft')
  expect(
    screen.getByText(
      'Saving failed. Your edits are kept. Reload saved settings if another administrator changed them.'
    )
  ).toBeVisible()
  await user.click(reload)
  expect(subject).toHaveValue('New saved subject')
  expect(
    screen.getByRole('switch', { name: 'Enable email templates' })
  ).toBeChecked()
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  expect(
    screen.queryByText(
      'Saving failed. Your edits are kept. Reload saved settings if another administrator changed them.'
    )
  ).not.toBeInTheDocument()
})

it('rejects an empty subject before sending settings and leaves the editor available for correction', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put')
  renderSettings()
  const subject = await screen.findByRole('textbox', { name: 'Email subject' })
  await user.clear(subject)
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(
    await screen.findByText(
      'Check every edited template: a subject is required (up to 240 characters), and HTML must be between 1 byte and 48 KB.'
    )
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  expect(subject).toBeEnabled()
})
