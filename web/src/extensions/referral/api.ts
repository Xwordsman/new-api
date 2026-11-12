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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  Invitee,
  ReferralAudit,
  ReferralDashboard,
  ReferralListParams,
  ReferralPage,
  ReferralReward,
  ReferralSettings,
  ReferralTransfer,
} from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
const base = '/api/extensions/referral'

export async function getDashboard(): Promise<ReferralDashboard> {
  const response = await api.get<Envelope<ReferralDashboard>>(
    `${base}/dashboard`
  )
  const data = requireServerSuccess(response.data).data
  if (!data.code) {
    const code = await api.get<Envelope<string>>('/api/user/aff')
    data.code = requireServerSuccess(code.data).data
  }
  return data
}

export async function getReferralList<
  T extends Invitee | ReferralReward | ReferralTransfer | ReferralAudit,
>(
  resource:
    | 'invitees'
    | 'rewards'
    | 'transfers'
    | 'admin/reviews'
    | 'admin/audit',
  params: ReferralListParams
): Promise<ReferralPage<T>> {
  const response = await api.get<Envelope<ReferralPage<T>>>(
    `${base}/${resource}`,
    { params }
  )
  return requireServerSuccess(response.data).data
}

export async function claimRewards(
  rewardID: number
): Promise<{ claimed: number }> {
  const response = await api.post<Envelope<{ claimed: number }>>(
    `${base}/claim`,
    { reward_id: rewardID }
  )
  return requireServerSuccess(response.data).data
}

export async function transferRewards(payload: {
  quota: number
  request_id: string
}): Promise<ReferralTransfer> {
  const response = await api.post<Envelope<ReferralTransfer>>(
    `${base}/transfer`,
    payload
  )
  return requireServerSuccess(response.data).data
}

export async function getReferralSettings(): Promise<ReferralSettings> {
  const response = await api.get<Envelope<ReferralSettings>>(
    `${base}/admin/settings`
  )
  return requireServerSuccess(response.data).data
}

export async function saveReferralSettings(
  settings: ReferralSettings
): Promise<void> {
  requireServerSuccess(
    (await api.put<Envelope<null>>(`${base}/admin/settings`, settings)).data
  )
}

export async function reviewInvitee(payload: {
  id: number
  approve: boolean
  reason: string
}): Promise<void> {
  requireServerSuccess(
    (
      await api.post<Envelope<null>>(
        `${base}/admin/reviews/${payload.id}`,
        payload
      )
    ).data
  )
}

export async function reconcileOrder(payload: {
  trade_no: string
  amount: string
  currency: string
  usd_per_unit: string
  reason: string
}): Promise<void> {
  requireServerSuccess(
    (await api.post<Envelope<null>>(`${base}/admin/reconcile`, payload)).data
  )
}

export async function refundOrder(payload: {
  trade_no: string
  amount: string
  reason: string
}): Promise<void> {
  requireServerSuccess(
    (await api.post<Envelope<null>>(`${base}/admin/refund`, payload)).data
  )
}
