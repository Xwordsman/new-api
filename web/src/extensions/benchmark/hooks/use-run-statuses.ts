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
import { useTranslation } from 'react-i18next'

import type { StatusVariant } from '@/components/status-badge'

import type { BenchmarkGroup, RunStatus } from '../types'

export function useRunStatuses(): Record<
  RunStatus,
  { label: string; variant: StatusVariant }
> {
  const { t } = useTranslation()
  return {
    running: { label: t('Checking'), variant: 'info' },
    passed: { label: t('Passed'), variant: 'success' },
    wrong_answer: { label: t('Answer mismatch'), variant: 'danger' },
    invalid: { label: t('Invalid SVG'), variant: 'warning' },
    truncated: { label: t('Output truncated'), variant: 'warning' },
    request_failed: { label: t('Request failed'), variant: 'warning' },
    timeout: { label: t('Timed out'), variant: 'warning' },
    interrupted: { label: t('Interrupted'), variant: 'neutral' },
  }
}

export function groupStatus(
  group: BenchmarkGroup
): 'passed' | 'suspected' | 'failed' | 'unknown' {
  if (!group.enabled) return 'unknown'
  const candy =
    group.candy_enabled &&
    group.runs.find((r) => r.kind === 'candy' && r.status !== 'running')
  const svg =
    group.svg_enabled &&
    group.runs.find((r) => r.kind === 'svg' && r.status !== 'running')
  if (candy && candy.status === 'wrong_answer') return 'suspected'
  if ([candy, svg].some((r) => r && r.status !== 'passed')) return 'failed'
  if (
    (group.candy_enabled && !candy) ||
    (group.svg_enabled && !svg) ||
    (!candy && !svg)
  ) {
    return 'unknown'
  }
  return 'passed'
}
