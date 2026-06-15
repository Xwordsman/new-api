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
import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

export function AuthPageAnnouncement() {
  const { status } = useStatus()
  const [announcement, setAnnouncement] = useState<string>('')
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!status) return

    const rawAnnouncement = status.auth_page_announcement
    const rawEnabled = status.auth_page_announcement_enabled

    setAnnouncement(typeof rawAnnouncement === 'string' ? rawAnnouncement : '')
    setEnabled(rawEnabled === true)
  }, [status])

  if (!enabled || !announcement.trim()) {
    return null
  }

  return (
    <Alert className={cn(
      'mb-6 border-2',
      'bg-primary/5 border-primary/20'
    )}>
      <AlertCircle className='h-5 w-5 text-primary' />
      <AlertTitle className='text-lg font-semibold text-primary'>
        公告
      </AlertTitle>
      <AlertDescription className='mt-2 text-base leading-relaxed'>
        <div
          className='prose prose-sm max-w-none dark:prose-invert'
          dangerouslySetInnerHTML={{ __html: announcement }}
        />
      </AlertDescription>
    </Alert>
  )
}
