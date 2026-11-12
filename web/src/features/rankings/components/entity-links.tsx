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

import { cn } from '@/lib/utils'

type EntityLinkBaseProps = {
  className?: string
  children?: React.ReactNode
}

type ModelLinkProps = EntityLinkBaseProps & {
  /** model_name as it appears in the pricing API. Used as the route param. */
  modelName: string
}

/**
 * Link wrapping a model name. Navigates to the existing model details
 * page (`/pricing/{modelName}`). Renders the model name itself by
 * default; pass `children` to wrap arbitrary content.
 *
 */
export function ModelLink(props: ModelLinkProps) {
  return (
    <Link
      to='/pricing/$modelId'
      params={{ modelId: props.modelName }}
      title={props.modelName}
      className={cn(
        'hover:text-primary focus-visible:ring-primary/50 rounded-xs transition-colors focus-visible:ring-2 focus-visible:outline-none',
        props.className
      )}
    >
      {props.children ?? props.modelName}
    </Link>
  )
}

type VendorLinkProps = EntityLinkBaseProps & {
  /** Display name of the vendor (e.g. "Google", "OpenAI"). */
  vendor: string
}

/**
 * Link wrapping a vendor name. Navigates to the pricing page filtered by
 * that vendor (`/pricing?vendor={vendor}`). Renders the vendor name
 * itself by default.
 */
export function VendorLink(props: VendorLinkProps) {
  return (
    <Link
      to='/pricing'
      search={{ vendor: props.vendor }}
      title={props.vendor}
      className={cn(
        'hover:text-primary focus-visible:ring-primary/50 rounded-xs transition-colors focus-visible:ring-2 focus-visible:outline-none',
        props.className
      )}
    >
      {props.children ?? props.vendor}
    </Link>
  )
}
