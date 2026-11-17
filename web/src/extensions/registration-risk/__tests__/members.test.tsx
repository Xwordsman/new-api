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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'

import { registrationQueryKey } from '../api'
import { MemberAnalysis } from '../components/member-analysis'
import { MemberDirectory } from '../components/member-directory'
import { MemberPolicySection } from '../components/member-policy-form'
import type {
  AnalysisResult,
  MemberPolicy,
  MemberProfile,
} from '../member-types'
import { RegistrationRiskSettingsPage } from '../settings-page'

const base = '/api/extensions/registration-risk/admin'
const policy: MemberPolicy = {
  revision: 2,
  capture_enabled: true,
  retention_days: 180,
  lookback_days: 30,
  device_limit: 2,
  signup_ip_limit: 3,
  login_ip_limit: 5,
  network_limit: 10,
  inviter_limit: 20,
  payer_limit: 2,
  auto_analysis: true,
  analysis_minutes: 60,
  alert_priority: 3,
}
const member: MemberProfile = {
  id: 42,
  username: 'historical-member',
  display_name: '',
  email: 'member@example.com',
  role: 1,
  status: 1,
  created_at: 1700000000,
  last_login_at: 1700001000,
  inviter_id: 0,
  remark: 'Original account remark',
  qualification: '',
  registration_ip: '',
  registration_agent: '',
  registration_source: '',
  registered_at: 0,
  last_login_ip: '192.0.2.10',
  last_login_agent: 'Example Browser',
  last_login_method: 'passkey',
  last_seen_at: 1700001000,
  note: '',
  review_state: '',
  reviewed_at: 0,
  reviewer_id: 0,
  version: 0,
}
const analysis: AnalysisResult = {
  status: 'succeeded',
  summary: {
    total: 2,
    flagged: 1,
    review: 0,
    priority: 0,
    insufficient: 1,
    completed_at: 1700002000,
    policy,
  },
  items: [
    {
      user_id: 42,
      username: member.username,
      coverage: 'partial',
      signal_count: 1,
      priority: 1,
      reward_paid: 0,
      reward_pending: 0,
      recommendation: 'network-clue',
      signals: [
        { code: 'login-ip', count: 5, threshold: 5, related_ids: [43] },
      ],
      note: '',
      review_state: '',
    },
  ],
  total: 1,
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

function mount(content: ReactNode) {
  render(<QueryClientProvider client={client}>{content}</QueryClientProvider>)
}

function mockReads(result: AnalysisResult = analysis) {
  return vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (url === `${base}/member-policy`) {
      return { data: { success: true, data: policy } }
    }
    if (url === `${base}/member-analysis`) {
      const params = config?.params as { kind: string }
      const items = result.items.filter(
        (item) => params.kind !== 'review' || item.priority >= 2
      )
      return {
        data: {
          success: true,
          data: { ...result, items, total: items.length },
        },
      }
    }
    if (url === `${base}/members`) {
      const params = config?.params as { user_id?: number } | undefined
      const id = params?.user_id ?? member.id
      return {
        data: {
          success: true,
          data: { items: [{ ...member, id }], total: 1, page: 1 },
        },
      }
    }
    // The settings request may remain pending while navigating to the new tabs.
    return new Promise(() => {})
  })
}

it('opens the new member tabs without waiting for the separate registration settings query', async () => {
  const user = userEvent.setup()
  mockReads()
  mount(<RegistrationRiskSettingsPage />)
  await user.click(screen.getByRole('tab', { name: 'Member profiles' }))
  expect(await screen.findByText(member.username)).toBeInTheDocument()
  await user.click(
    screen.getByRole('tab', { name: 'Existing-member analysis' })
  )
  expect(
    await screen.findByRole('button', { name: 'Analyze all members' })
  ).toBeEnabled()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Analysis results' }),
    'flagged'
  )
  expect(await screen.findByText('Same last login IP')).toBeInTheDocument()
})

it('keeps missing signup metadata explicit and requires a note before saving a review', async () => {
  const user = userEvent.setup()
  const get = mockReads()
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: false,
      message: 'Member profile changed. Reload before saving.',
    },
  })
  mount(<MemberDirectory />)
  const row = await screen.findByRole('row', { name: /historical-member/ })
  expect(within(row).getByText('Not recorded')).toBeInTheDocument()
  expect(within(row).getAllByText('192.0.2.10')).toHaveLength(1)
  await user.click(
    within(row).getByRole('button', { name: 'Details and review' })
  )
  const dialog = await screen.findByRole('dialog')
  expect(get).toHaveBeenCalledWith(
    `${base}/members`,
    expect.objectContaining({
      params: expect.objectContaining({ user_id: 42 }),
    })
  )
  expect(
    within(dialog).getByText('Original account remark')
  ).toBeInTheDocument()
  const signupLabel = within(dialog).getByText('Registration IP')
  expect(signupLabel.nextElementSibling).toHaveTextContent('Not recorded')
  await user.selectOptions(
    within(dialog).getByRole('combobox', { name: 'Member review status' }),
    'watch'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Save review' }))
  expect(
    await within(dialog).findByText('Enter a review note.')
  ).toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
  const note = within(dialog).getByRole('textbox', {
    name: 'Member review note',
  })
  await user.type(note, 'Shared network needs verification')
  await user.click(within(dialog).getByRole('button', { name: 'Save review' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(`${base}/members/review`, {
      user_id: 42,
      version: 0,
      state: 'watch',
      note: 'Shared network needs verification',
    })
  )
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: 'Save review' })
    ).toBeEnabled()
  )
  expect(note).toHaveValue('Shared network needs verification')
  expect(dialog).toBeInTheDocument()
  post.mockResolvedValue({ data: { success: true, data: null } })
  await user.click(within(dialog).getByRole('button', { name: 'Save review' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it('sends member search and review filters to the server and offers retry on read failure', async () => {
  const user = userEvent.setup()
  const get = mockReads()
  mount(<MemberDirectory />)
  await screen.findByText(member.username)
  await user.type(
    screen.getByRole('textbox', { name: 'Search members' }),
    '192.0.2.10'
  )
  await user.click(screen.getByRole('button', { name: /^Search$/ }))
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Member review status' }),
    'watch'
  )
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      `${base}/members`,
      expect.objectContaining({
        params: { page: 1, search: '192.0.2.10', review_state: 'watch' },
      })
    )
  )
  get.mockRejectedValueOnce(new Error('Unavailable'))
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(
    await screen.findByRole('button', { name: 'Retry' })
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument()
  )
})

it('validates association thresholds and preserves policy edits until an explicit reload', async () => {
  const user = userEvent.setup()
  const get = mockReads()
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: { ...policy, revision: 3, login_ip_limit: 0 },
    },
  })
  mount(<MemberPolicySection />)
  const section = screen.getByRole('button', {
    name: 'Member data and analysis settings',
  })
  expect(section).toHaveAttribute('aria-expanded', 'false')
  await user.click(section)
  const threshold = await screen.findByRole('spinbutton', {
    name: 'Same last login IP threshold',
  })
  await user.clear(threshold)
  await user.type(threshold, '1')
  await user.click(
    screen.getByRole('button', { name: 'Save analysis settings' })
  )
  expect(
    await screen.findByText(
      'Use 0 to disable, or a threshold between 2 and 100000.'
    )
  ).toBeInTheDocument()
  expect(put).not.toHaveBeenCalled()
  get.mockResolvedValue({
    data: {
      success: true,
      data: { ...policy, revision: 3, login_ip_limit: 8 },
    },
  })
  await act(async () => {
    await client.invalidateQueries({ queryKey: registrationQueryKey })
  })
  expect(threshold).toHaveValue(1)
  await user.click(
    screen.getByRole('button', { name: 'Reload saved settings' })
  )
  expect(threshold).toHaveValue(8)
  await user.clear(threshold)
  await user.type(threshold, '0')
  await user.click(
    screen.getByRole('switch', { name: 'Automatically analyze members' })
  )
  const interval = screen.getByRole('spinbutton', {
    name: 'Automatic analysis interval (minutes)',
  })
  await user.clear(interval)
  await user.type(interval, '90')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Member analysis alert level' }),
    '2'
  )
  await user.click(
    screen.getByRole('button', { name: 'Save analysis settings' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(`${base}/member-policy`, {
      ...policy,
      revision: 3,
      login_ip_limit: 0,
      auto_analysis: false,
      analysis_minutes: 90,
      alert_priority: 2,
    })
  )
})

it('retains the last completed evidence after failure and opens the related member', async () => {
  const user = userEvent.setup()
  const get = mockReads({ ...analysis, status: 'failed' })
  mount(<MemberAnalysis />)
  expect(
    await screen.findByText(
      'Member analysis failed. Previous results are retained.'
    )
  ).toBeInTheDocument()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Analysis results' }),
    'flagged'
  )
  expect(
    await screen.findByText('Matched 5 accounts; threshold 5')
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '#43' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(get).toHaveBeenCalledWith(
    `${base}/members`,
    expect.objectContaining({
      params: expect.objectContaining({ user_id: 43 }),
    })
  )
})

it('prevents duplicate analyses while a task is pending and retains the previous evidence', async () => {
  const user = userEvent.setup()
  mockReads({ ...analysis, status: 'pending' })
  const post = vi.spyOn(api, 'post')
  mount(<MemberAnalysis />)
  expect(
    await screen.findByRole('button', { name: 'Analysis in progress' })
  ).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Previous completed results remain visible.'
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Analysis results' }),
    'flagged'
  )
  expect(await screen.findByText('Same last login IP')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Analysis in progress' }))
  expect(post).not.toHaveBeenCalled()
})

it('defaults to reward review evidence and shows network-only associations on request', async () => {
  const user = userEvent.setup()
  const get = mockReads({
    ...analysis,
    items: [
      ...analysis.items,
      {
        ...analysis.items[0],
        user_id: 44,
        username: 'shared-browser-member',
        priority: 3,
        reward_paid: 500000,
        reward_pending: 1000000,
        signals: [
          { code: 'device', count: 2, threshold: 2, related_ids: [45] },
        ],
      },
    ],
  })
  mount(<MemberAnalysis />)
  const row = await screen.findByRole('row', { name: /shared-browser-member/ })
  expect(within(row).getByText('Reward review priority')).toBeInTheDocument()
  expect(
    within(row).getByText(/Automatically issued.*\$1$/)
  ).toBeInTheDocument()
  expect(within(row).getByText(/Pending.*\$2$/)).toBeInTheDocument()
  expect(screen.queryByText(member.username)).not.toBeInTheDocument()
  expect(get).toHaveBeenCalledWith(
    `${base}/member-analysis`,
    expect.objectContaining({ params: { page: 1, kind: 'review' } })
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Analysis results' }),
    'flagged'
  )
  const networkRow = await screen.findByRole('row', {
    name: /historical-member/,
  })
  expect(within(networkRow).getByText('Network clue only')).toBeInTheDocument()
  expect(
    within(networkRow).getByText(
      'Shared networks alone do not prove duplicate accounts.'
    )
  ).toBeInTheDocument()
})
