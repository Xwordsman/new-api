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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, test } from 'vitest'

import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { getAvailableGroups } from '@/features/pricing/lib/model-helpers'
import type { PricingData, PricingModel } from '@/features/pricing/types'

import { orderGroupNames } from '../group-order'

describe('group display order', () => {
  test('preserves configured numeric identifiers and appends unconfigured groups consistently', () => {
    expect(orderGroupNames(['2', '10', 'vip', 'default'], ['10', '2'])).toEqual(
      ['10', '2', 'default', 'vip']
    )
  })
  test('excludes removed or hidden groups and ignores duplicate order entries', () => {
    expect(
      orderGroupNames(
        ['vip', 'default', 'vip'],
        ['hidden', 'vip', 'vip', 'deleted']
      )
    ).toEqual(['vip', 'default'])
    expect(orderGroupNames([], ['hidden'])).toEqual([])
    expect(orderGroupNames(['default'])).toEqual(['default'])
  })
  test('uses a deterministic fallback without configuration', () => {
    expect(orderGroupNames(['vip', 'default'])).toEqual(['default', 'vip'])
  })
  test('keeps model detail pricing ordered and limits it to available enabled groups', () => {
    const model = {
      enable_groups: ['default', 'vip', 'hidden'],
    } as PricingModel
    const usable = {
      default: { desc: '', ratio: 1 },
      vip: { desc: '', ratio: 2 },
      other: { desc: '', ratio: 3 },
    }
    expect(
      getAvailableGroups(model, usable, ['hidden', 'vip', 'default', 'other'])
    ).toEqual(['vip', 'default'])
  })
  test('orders catalog filters and model labels without changing the cached response or Auto routing', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const data: PricingData = {
      success: true,
      data: [
        {
          id: 1,
          model_name: 'gpt-test',
          quota_type: 0,
          model_ratio: 1,
          completion_ratio: 1,
          enable_groups: ['default', 'vip'],
        },
      ],
      vendors: [],
      group_ratio: { default: 1, vip: 0.8 },
      group_order: ['vip', 'default', 'removed'],
      usable_group: {
        default: { desc: 'Default', ratio: 1 },
        vip: { desc: 'VIP', ratio: 0.8 },
      },
      supported_endpoint: {},
      auto_groups: ['default', 'vip'],
    }
    client.setQueryData(['pricing'], data)
    client.setQueryData(['status'], { price: 1 })
    const view = renderHook(() => usePricingData(false), {
      wrapper: (props: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, props.children),
    })
    try {
      expect(view.result.current.groupOrder).toEqual(['vip', 'default'])
      expect(view.result.current.models[0].enable_groups).toEqual([
        'vip',
        'default',
      ])
      expect(view.result.current.autoGroups).toEqual(['default', 'vip'])
      expect(data.data[0].enable_groups).toEqual(['default', 'vip'])
    } finally {
      view.unmount()
      client.clear()
    }
  })
})
