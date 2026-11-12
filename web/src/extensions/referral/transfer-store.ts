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
import { z } from 'zod'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

const pendingSchema = z.record(
  z.string(),
  z.object({
    quota: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    request_id: z.string().min(16).max(64),
  })
)
type PendingTransfer = { quota: number; request_id: string }
type TransferState = {
  requests: Record<string, PendingTransfer>
  setRequest: (userID: number, request: PendingTransfer | null) => void
}

// Only non-secret retry identifiers and amounts are retained, per account.
// Restricted browser storage must not break a transfer already in progress.
export const useReferralTransferStore = create<TransferState>()(
  persist(
    (set) => ({
      requests: {},
      setRequest: (userID, request) =>
        set((state) => {
          const requests = { ...state.requests }
          if (request) requests[userID] = request
          else delete requests[userID]
          return { requests }
        }),
    }),
    {
      name: 'referral-pending-transfers',
      version: 1,
      partialize: (state) => ({ requests: state.requests }),
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          try {
            return sessionStorage.getItem(name)
          } catch {
            return null
          }
        },
        setItem: (name, value) => {
          try {
            sessionStorage.setItem(name, value)
          } catch {
            /* Keep the in-memory retry key. */
          }
        },
        removeItem: (name) => {
          try {
            sessionStorage.removeItem(name)
          } catch {
            /* Storage may be disabled. */
          }
        },
      })),
      merge: (persisted, current) => {
        const parsed = z
          .object({ requests: pendingSchema })
          .safeParse(persisted)
        return {
          ...current,
          requests: parsed.success ? parsed.data.requests : {},
        }
      },
    }
  )
)
