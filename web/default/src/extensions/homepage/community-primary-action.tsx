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
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CommunityPrimaryActionProps = {
  isAuthenticated: boolean
  registerEnabled: boolean
  label: string
  className?: string
}

export function CommunityPrimaryAction(props: CommunityPrimaryActionProps) {
  const content = (
    <>
      <ArrowRight className='ico' aria-hidden='true' />
      {props.label}
    </>
  )
  const className = cn(props.className)

  if (props.isAuthenticated) {
    return (
      <Button className={className} render={<Link to='/dashboard' />}>
        {content}
      </Button>
    )
  }

  if (props.registerEnabled) {
    return (
      <Button className={className} render={<Link to='/sign-up' />}>
        {content}
      </Button>
    )
  }

  return (
    <Button className={className} render={<Link to='/sign-in' />}>
      {content}
    </Button>
  )
}
