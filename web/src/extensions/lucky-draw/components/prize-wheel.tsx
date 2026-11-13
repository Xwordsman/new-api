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
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'

import type { DrawResult, Prize } from '../types'

// Equal sectors keep labels readable. Only the server's saved result chooses
// the destination; sector size deliberately does not imply probability.
export function PrizeWheel(props: {
  prizes: Prize[]
  result?: DrawResult
  animate: boolean
}) {
  const { t, i18n } = useTranslation()
  const reduced = useReducedMotion()
  const [finished, setFinished] = useState(false)
  const prizes = props.result?.prizes ?? props.prizes
  const count = prizes.length
  const index = prizes.findIndex((p) => p.id === props.result?.record.prize_id)
  const rotation = index < 0 ? 0 : 1800 + (360 - ((index + 0.5) * 360) / count)
  const spinning = !!props.result && props.animate && !reduced && !finished
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <div className='space-y-5 text-center'>
      <div
        className='relative mx-auto aspect-square w-full max-w-[380px]'
        aria-hidden='true'
      >
        <div className='text-primary absolute -top-1 left-1/2 z-10 -translate-x-1/2 text-4xl drop-shadow'>
          ▼
        </div>
        <motion.div
          className='border-background ring-border absolute inset-0 overflow-hidden rounded-full border-8 shadow-xl ring-1'
          initial={{ rotate: props.animate ? 0 : rotation }}
          animate={{ rotate: rotation }}
          transition={{
            duration: spinning ? 4 : 0,
            ease: [0.12, 0.8, 0.15, 1],
          }}
          onAnimationComplete={() => setFinished(true)}
          style={{
            background: `conic-gradient(${prizes.map((p, i) => `${p.color} ${(i * 360) / count}deg ${((i + 1) * 360) / count}deg`).join(',')})`,
          }}
        >
          {prizes.map((p, i) => (
            <div
              key={p.id}
              className='absolute inset-0'
              style={{ transform: `rotate(${((i + 0.5) * 360) / count}deg)` }}
            >
              <span className='absolute top-[15%] left-1/2 line-clamp-2 w-[30%] -translate-x-1/2 rounded bg-black/75 px-1 py-1 text-xs font-semibold text-white'>
                {t(p.name)}
              </span>
            </div>
          ))}
        </motion.div>
        <div className='border-background bg-card absolute inset-[38%] grid place-items-center rounded-full border-4 shadow-lg'>
          <span className='text-primary text-lg font-semibold'>
            {t('Lucky draw')}
          </span>
        </div>
      </div>
      {spinning && (
        <Button variant='ghost' onClick={() => setFinished(true)}>
          {t('Skip animation')}
        </Button>
      )}
      <div role='status' aria-live='polite' className='min-h-16'>
        {props.result && !spinning && (
          <>
            <p className='text-xl font-semibold'>
              {t(props.result.record.prize_name)}
            </p>
            <p className='text-muted-foreground mt-1 text-sm'>
              {props.result.record.quota_awarded > 0
                ? t('Credited to your wallet: {{amount}}', {
                    amount: formatQuotaWithCurrency(
                      props.result.record.quota_awarded,
                      { locale, abbreviate: false }
                    ),
                  })
                : t('Better luck next time')}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
