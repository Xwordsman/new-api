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
      member,
      group_id: 42,
      priority: 1,
      signals: ['login-ip'],
      related_accounts: [],
      binding: null,
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
        (row) =>
          params.kind !== 'review' ||
          row.priority >= 2 ||
          row.binding?.state === 'review'
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
  expect(await screen.findByText('Same last login IP')).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: /#42 historical-member/ })
  )
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(get).toHaveBeenCalledWith(
    `${base}/members`,
    expect.objectContaining({
      params: expect.objectContaining({ user_id: 42 }),
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

it('shows one account per row with separate evidence and reward columns and reviews only its own invitation', async () => {
  const user = userEvent.setup()
  const binding = {
    id: 9,
    user_id: 45,
    inviter_id: 44,
    username: 'related-member',
    inviter_name: 'shared-browser-member',
    state: 'review',
    reason: 'Associated accounts require referral review',
    signup_bonus_quota: 500000,
    signup_bonus_paid_at: 0,
    pending: 1000000,
  }
  const get = mockReads({
    ...analysis,
    items: [
      ...analysis.items,
      {
        member: { ...member, id: 44, username: 'shared-browser-member' },
        group_id: 44,
        priority: 3,
        signals: ['device'],
        related_accounts: [{ id: 45, username: 'related-member' }],
        binding: null,
      },
      {
        member: {
          ...member,
          id: 45,
          username: 'related-member',
          registration_ip: '2001:db8::45',
        },
        group_id: 44,
        priority: 3,
        signals: ['device'],
        related_accounts: [{ id: 44, username: 'shared-browser-member' }],
        binding,
      },
    ],
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  mount(<MemberAnalysis />)
  await screen.findByRole('button', { name: '#45 related-member' })
  const row = screen
    .getByRole('button', { name: '#45 related-member' })
    .closest('tr')
  const inviterRow = screen.getByRole('cell', { name: '44' }).closest('tr')
  if (!row || !inviterRow) {
    throw new Error('Account rows are missing')
  }
  expect(row).not.toBe(inviterRow)
  expect(
    within(inviterRow).queryByRole('button', {
      name: 'Approve referral qualification',
    })
  ).not.toBeInTheDocument()
  expect(within(inviterRow).queryByText('2001:db8::45')).not.toBeInTheDocument()
  for (const column of [
    'Registration IP',
    'Last login IP',
    'Browser / UA',
    'Associated accounts',
    'Signup bonus',
    'Pending payment rewards',
    'Referral status',
    'Actions',
  ]) {
    expect(screen.getByRole('columnheader', { name: column })).toBeVisible()
  }
  expect(within(row).getByText('Shared browser marker')).toBeVisible()
  expect(within(row).getAllByText(/192\.0\.2\.10/)).toHaveLength(1)
  expect(within(row).getAllByText(/Example Browser/)).toHaveLength(1)
  expect(within(row).getByText('2001:db8::45')).toBeVisible()
  expect(
    within(row).getByText('Held until administrator approval')
  ).toBeVisible()
  expect(within(row).getByText('$1')).toBeVisible()
  expect(within(row).getByText('$2')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /#42 historical-member/ })
  ).not.toBeInTheDocument()
  expect(get).toHaveBeenCalledWith(
    `${base}/member-analysis`,
    expect.objectContaining({
      params: {
        page: 1,
        page_size: 20,
        search: '',
        kind: 'review',
        view: 'accounts',
      },
    })
  )
  await user.click(
    within(row).getByRole('button', { name: 'Approve referral qualification' })
  )
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
  expect(post).not.toHaveBeenCalled()
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Review reason' }),
    'Verified independent accounts'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/extensions/referral/admin/reviews/9',
      {
        id: 9,
        approve: true,
        reason: 'Verified independent accounts',
      }
    )
  )
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Analysis results' }),
    'flagged'
  )
  const networkRow = await screen.findByRole('row', {
    name: /historical-member/,
  })
  expect(within(networkRow).getByText('Network clue only')).toBeVisible()
  expect(
    within(networkRow).queryByRole('button', {
      name: 'Approve referral qualification',
    })
  ).not.toBeInTheDocument()
})

it('lets administrators hide and restore evidence columns through the shared view menu', async () => {
  const user = userEvent.setup()
  mockReads({ ...analysis, items: [{ ...analysis.items[0], priority: 3 }] })
  mount(<MemberAnalysis />)
  await screen.findByRole('columnheader', { name: 'Registration IP' })
  await user.click(screen.getByRole('button', { name: 'View' }))
  await user.click(
    screen.getByRole('menuitemcheckbox', { name: 'Registration IP' })
  )
  expect(
    screen.queryByRole('columnheader', { name: 'Registration IP' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Username' })).toBeVisible()
  await user.click(
    screen.getByRole('menuitemcheckbox', { name: 'Registration IP' })
  )
  expect(
    screen.getByRole('columnheader', { name: 'Registration IP' })
  ).toBeVisible()
})

it('keeps previously held rewards actionable when current association evidence is unavailable', async () => {
  mockReads({
    ...analysis,
    items: [
      {
        member: { ...member, id: 45, username: 'related-member' },
        group_id: 45,
        priority: 0,
        signals: [],
        related_accounts: [],
        binding: {
          id: 9,
          user_id: 45,
          inviter_id: member.id,
          username: 'related-member',
          inviter_name: member.username,
          state: 'review',
          reason: 'Associated accounts require referral review',
          signup_bonus_quota: 500000,
          signup_bonus_paid_at: 0,
          pending: 0,
        },
      },
    ],
  })
  mount(<MemberAnalysis />)
  expect(
    await screen.findByText('Held until administrator approval')
  ).toBeVisible()
  expect(
    screen.getByText('Associated accounts require referral review')
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Approve referral qualification' })
  ).toBeEnabled()
  expect(screen.queryByText('Network clue only')).not.toBeInTheDocument()
})

it('paginates by account and keeps long account evidence truncated in a horizontally scrollable table', async () => {
  const user = userEvent.setup()
  const longUA = `Browser/${'long-agent-'.repeat(60)}`
  const get = mockReads()
  get.mockImplementation(async (url, config) => {
    if (url === `${base}/member-analysis`) {
      const params = config?.params as { page: number }
      const id = params.page === 1 ? 44 : 45
      return {
        data: {
          success: true,
          data: {
            ...analysis,
            total: 21,
            items: [
              {
                ...analysis.items[0],
                member: {
                  ...member,
                  id,
                  username: `account-${id}`,
                  last_login_agent: longUA,
                },
                priority: 3,
              },
            ],
          },
        },
      }
    }
    return { data: { success: true, data: policy } }
  })
  mount(<MemberAnalysis />)
  const row = await screen.findByRole('row', { name: /account-44/ })
  const agent = within(row).getByText(longUA)
  expect(agent).toHaveClass('truncate')
  expect(agent.closest('[tabindex]')).toHaveAttribute('tabindex', '0')
  expect(row.closest('[data-slot="table-container"]')).toHaveClass(
    'overflow-x-auto'
  )
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  expect(
    await screen.findByRole('button', { name: '#45 account-45' })
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: '#44 account-44' })
  ).not.toBeInTheDocument()
  expect(get).toHaveBeenCalledWith(
    `${base}/member-analysis`,
    expect.objectContaining({
      params: {
        page: 2,
        page_size: 20,
        search: '',
        kind: 'review',
        view: 'accounts',
      },
    })
  )
  await user.type(screen.getByPlaceholderText('Search members'), '192.0.2.10')
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      `${base}/member-analysis`,
      expect.objectContaining({
        params: {
          page: 1,
          page_size: 20,
          search: '192.0.2.10',
          kind: 'review',
          view: 'accounts',
        },
      })
    )
  )
})
