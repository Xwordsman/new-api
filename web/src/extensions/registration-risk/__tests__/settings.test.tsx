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
import { useAuthStore } from '@/stores/auth-store'

import { registrationQueryKey } from '../api'
import { CreditReviewDialog } from '../components/review-dialog'
import { registrationSettingsSchema, settingsToForm } from '../lib/schema'
import { RegistrationRiskSettingsPage } from '../settings-page'
import type { RegistrationSettings } from '../types'

const fixture: RegistrationSettings = {
  revision: 2,
  mode: 'observe',
  require_email: true,
  oauth_email_action: 'review',
  captcha: false,
  captcha_hostname: '',
  code_ttl_seconds: 600,
  resend_seconds: 60,
  code_max_failures: 5,
  code_failure_window: 3600,
  domain_action: 'deny',
  allow_only: false,
  blocked_domains: ['mail.tm'],
  allowed_domains: [],
  domain_exceptions: [],
  ipv4_prefix: 24,
  ipv6_prefix: 56,
  device_days: 180,
  rules: [],
  bonus_enabled: true,
  bonus_quota: 1000,
  bonus_days: 7,
  bonus_daily_quota: 50000000,
  bonus_models: [],
  bonus_rpm: 5,
  bonus_concurrency: 1,
  lease_seconds: 1800,
  shared_payer_action: 'review',
  hold_referral: true,
  alert_enabled: false,
  alert_emails: [],
  alert_webhook: '',
  alert_minutes: 5,
  alert_window_minutes: 60,
  alert_risk_count: 10,
  alert_email_count: 50,
  alert_completion_percent: 10,
  alert_budget_percent: 80,
  alert_dedup_minutes: 60,
  retention_days: 90,
}
let client: QueryClient

beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
})
afterEach(() => {
  client.clear()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

function renderSettings() {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: fixture },
  })
  render(
    <QueryClientProvider client={client}>
      <RegistrationRiskSettingsPage />
    </QueryClientProvider>
  )
}

it('keeps advanced policies collapsed and saves parsed model lists after keyboard expansion', async () => {
  const user = userEvent.setup()
  renderSettings()
  const section = await screen.findByRole('button', {
    name: 'Promotional credit and spending limits',
  })
  expect(section).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.queryByRole('spinbutton', {
      name: 'Promotional credit validity (days)',
    })
  ).not.toBeInTheDocument()
  section.focus()
  await user.keyboard('{Enter}')
  expect(section).toHaveAttribute('aria-expanded', 'true')
  const days = screen.getByRole('spinbutton', {
    name: 'Promotional credit validity (days)',
  })
  await user.clear(days)
  await user.type(days, '14')
  await user.type(
    screen.getByRole('textbox', {
      name: 'Models eligible for promotional credit',
    }),
    'gpt-5, gpt-5{Enter}gpt-4.1'
  )
  await user.click(section)
  const saved = {
    ...fixture,
    revision: 3,
    bonus_days: 14,
    bonus_models: ['gpt-5', 'gpt-4.1'],
  }
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: saved } })
  vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: saved } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/registration-risk/admin/settings',
      { ...saved, revision: 2 }
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  )
})

it('reveals invalid hidden fields and preserves edits after a revision conflict', async () => {
  const user = userEvent.setup()
  renderSettings()
  const section = await screen.findByRole('button', {
    name: 'Email verification and domain policy',
  })
  await user.click(section)
  const lifetime = screen.getByRole('spinbutton', {
    name: 'Verification code lifetime (seconds)',
  })
  await user.clear(lifetime)
  await user.type(lifetime, '0')
  await user.click(section)
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message: 'Registration risk settings changed. Reload before saving.',
    },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(section).toHaveAttribute('aria-expanded', 'true'))
  expect(lifetime).toHaveAttribute('aria-invalid', 'true')
  expect(
    screen.getByText('Check this value and the permitted limits')
  ).toBeInTheDocument()
  expect(put).not.toHaveBeenCalled()
  await user.clear(lifetime)
  await user.type(lifetime, '900')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(lifetime).toHaveValue(900)
})

it('preserves pending edits during refresh and explicitly reloads the newer revision', async () => {
  const user = userEvent.setup()
  renderSettings()
  await user.click(
    await screen.findByRole('button', {
      name: 'Email verification and domain policy',
    })
  )
  const lifetime = screen.getByRole('spinbutton', {
    name: 'Verification code lifetime (seconds)',
  })
  await user.clear(lifetime)
  await user.type(lifetime, '900')
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: { ...fixture, revision: 3, code_ttl_seconds: 1200 },
    },
  })
  await act(async () => {
    await client.invalidateQueries({ queryKey: registrationQueryKey })
  })
  expect(lifetime).toHaveValue(900)
  await user.click(
    await screen.findByRole('button', { name: 'Reload saved settings' })
  )
  expect(lifetime).toHaveValue(1200)
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

it('requires a review reason and keeps the dialog and reason after server rejection', async () => {
  const user = userEvent.setup()
  const close = vi.fn()
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: false,
      message: 'Registration risk settings changed. Reload before saving.',
    },
  })
  render(
    <QueryClientProvider client={client}>
      <CreditReviewDialog userId={42} approve onClose={close} />
    </QueryClientProvider>
  )
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(
    await screen.findByText('Enter a reason between 3 and 500 characters.')
  ).toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
  const reason = screen.getByRole('textbox', { name: 'Review reason' })
  await user.type(reason, 'Verified customer')
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/extensions/registration-risk/admin/review',
      { user_id: 42, approve: true, reason: 'Verified customer' }
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  )
  expect(reason).toHaveValue('Verified customer')
  expect(close).not.toHaveBeenCalled()
})

it('rejects unsafe policies, wildcard models, insecure webhooks and an empty required domain allowlist', () => {
  const values = settingsToForm(fixture)
  expect(registrationSettingsSchema.safeParse(values).success).toBe(true)
  for (const invalid of [
    { code_ttl_seconds: 0 },
    { bonus_quota: -1 },
    { bonus_daily_quota: Number.MAX_SAFE_INTEGER + 1 },
    { blocked_domains: '*.com' },
    { bonus_models: 'gpt-*' },
    { alert_webhook: 'http://insecure.example' },
    { allow_only: true, allowed_domains: '' },
    { ipv6_prefix: 129 },
  ]) {
    expect(
      registrationSettingsSchema.safeParse({ ...values, ...invalid }).success
    ).toBe(false)
  }
})
