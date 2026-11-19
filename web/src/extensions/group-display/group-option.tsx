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
import { Layers2, Zap } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { GroupRatioBadge } from '@/features/keys/components/auto-group-visuals'
import { getLobeIcon } from '@/lib/lobe-icon'

import type { GroupDisplayOption } from './types'

export function GroupOptionContents(props: {
  option: GroupDisplayOption
  shouldReduceMotion?: boolean
}) {
  const { t } = useTranslation()
  const option = props.option
  const icon = option.appearance?.icon || option.category?.icon
  const FallbackIcon = option.value === 'auto' ? Zap : Layers2
  return (
    <>
      <span aria-hidden='true' className='group-display-icon'>
        {icon ? getLobeIcon(icon, 18) : <FallbackIcon />}
      </span>
      <span className='group-display-copy min-w-0 flex-1'>
        <span className='group-display-title'>
          <span className='group-display-name-line'>
            <span
              className='group-display-name'
              data-featured={option.appearance?.featured || undefined}
              data-reduced-motion={props.shouldReduceMotion || undefined}
              title={option.label}
            >
              {option.label}
            </span>
            {option.appearance?.featured && (
              <StatusBadge
                label={t('Featured')}
                copyable={false}
                type='badge'
                variant='purple'
                className='group-display-featured'
              />
            )}
          </span>
          {option.appearance?.tags.map((tag) => (
            <StatusBadge
              key={tag.label}
              copyable={false}
              label={tag.label}
              style={
                {
                  '--tag-color': tag.color || 'var(--group-color)',
                } as CSSProperties
              }
              className='group-display-tag'
            />
          ))}
        </span>
        {option.desc && (
          <span title={option.desc} className='group-display-description'>
            {option.desc}
          </span>
        )}
      </span>
      <span className='group-display-ratio'>
        <GroupRatioBadge
          ratio={option.ratio}
          isAuto={option.value === 'auto'}
          shouldReduceMotion={props.shouldReduceMotion}
          className='group-display-multiplier'
        />
      </span>
    </>
  )
}
