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
import { Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { cn } from '@/lib/utils'

interface HeroTerminalDemoProps {
  className?: string
  compact?: boolean
}

export function HeroTerminalDemo(props: HeroTerminalDemoProps) {
  const { t } = useTranslation()
  const endpoint = `${window.location.origin}/v1/chat/completions`
  const example = `curl ${endpoint} \\\n  -H "Authorization: Bearer $NEW_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "your-model",\n    "messages": [{ "role": "user", "content": "Hello!" }],\n    "stream": true\n  }'`

  return (
    <div
      className={cn(
        'home-terminal',
        props.compact && 'home-terminal-compact',
        props.className
      )}
    >
      <div className='home-terminal-bar'>
        <span>
          <Terminal className='size-3.5' aria-hidden />
          first-request.sh
        </span>
        <CopyButton
          value={example}
          variant='ghost'
          size='icon'
          className='home-terminal-copy'
          aria-label={t('Copy integration example')}
        />
      </div>
      <pre tabIndex={0} aria-label={t('Integration example')}>
        <code>
          <span className='home-code-purple'>curl</span> {endpoint}
          {' \\\n'}
          <span className='home-code-muted'>{'  -H '}</span>
          {'"Authorization: Bearer $NEW_API_KEY" \\\n'}
          <span className='home-code-muted'>{'  -H '}</span>
          {'"Content-Type: application/json" \\\n'}
          <span className='home-code-muted'>{"  -d '{\n"}</span>
          {'    '}
          <span className='home-code-purple'>"model"</span>
          {': "your-model",\n    '}
          <span className='home-code-purple'>"messages"</span>
          {': [{ "role": "user",\n      "content": "Hello!" }],\n    '}
          <span className='home-code-purple'>"stream"</span>
          {": true\n  }'"}
        </code>
      </pre>
      {!props.compact && (
        <p className='home-terminal-note'>
          {t('Use your own API key to send a real request.')}
        </p>
      )}
    </div>
  )
}
