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
  AnalysisResult,
  MemberFilter,
  MemberPolicy,
  MemberProfile,
  MemberReviewState,
} from './member-types'

const base = '/api/extensions/registration-risk/admin'
type Envelope<T> = { success: boolean; message: string; data: T }

export async function getMembers(params: MemberFilter, signal?: AbortSignal) {
  return requireServerSuccess(
    (
      await api.get<
        Envelope<{ items: MemberProfile[]; total: number; page: number }>
      >(`${base}/members`, { params, signal })
    ).data
  ).data
}
export async function reviewMember(body: {
  user_id: number
  version: number
  state: MemberReviewState
  note: string
}) {
  requireServerSuccess(
    (await api.post<Envelope<null>>(`${base}/members/review`, body)).data
  )
}
export async function getMemberPolicy(signal?: AbortSignal) {
  return requireServerSuccess(
    (await api.get<Envelope<MemberPolicy>>(`${base}/member-policy`, { signal }))
      .data
  ).data
}
export async function saveMemberPolicy(body: MemberPolicy) {
  return requireServerSuccess(
    (await api.put<Envelope<MemberPolicy>>(`${base}/member-policy`, body)).data
  ).data
}
export async function getMemberAnalysis(
  params: { page: number; kind: string },
  signal?: AbortSignal
) {
  return requireServerSuccess(
    (
      await api.get<Envelope<AnalysisResult>>(`${base}/member-analysis`, {
        params: { ...params, view: 'groups' },
        signal,
      })
    ).data
  ).data
}
export async function startMemberAnalysis() {
  return requireServerSuccess(
    (
      await api.post<Envelope<{ status: AnalysisResult['status'] }>>(
        `${base}/member-analysis`
      )
    ).data
  ).data
}
