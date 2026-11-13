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
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type DrawRequest = { key: string; version: number; resolved: boolean }
type DrawStore = {
  requests: Record<string, DrawRequest>
  remember: (userId: number, request: DrawRequest) => void
  forget: (userId: number) => void
}

// Only non-secret request identities are stored. The server always determines
// ownership, eligibility and rewards, including after a browser refresh.
export const useDrawStore = create<DrawStore>()(
  persist(
    (set) => ({
      requests: {},
      remember: (id, request) =>
        set((state) => ({ requests: { ...state.requests, [id]: request } })),
      forget: (id) =>
        set((state) => {
          const requests = { ...state.requests }
          delete requests[id]
          return { requests }
        }),
    }),
    {
      name: 'lucky-draw-requests-v1',
      partialize: (state) => ({ requests: state.requests }),
    }
  )
)
