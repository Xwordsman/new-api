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
import { cn } from '@/lib/utils'

export function StatCardValue(props: {
  value: string | number
  currencySymbol?: string
  className?: string
  title?: string
}) {
  const value = String(props.value)
  const symbol = props.currencySymbol ?? ''
  const symbolIndex = symbol ? value.indexOf(symbol) : -1

  return (
    <div
      className={cn(
        'text-foreground font-metric text-4xl leading-none font-light tracking-[-0.01em] break-all tabular-nums sm:text-[42px]',
        props.className
      )}
      title={props.title}
    >
      {symbolIndex < 0 ? (
        value
      ) : (
        <>
          {value.slice(0, symbolIndex)}
          <span className='text-primary relative top-[0.6em] me-1.5 inline-block align-top text-sm leading-none font-normal tracking-normal'>
            {symbol}
          </span>
          {value.slice(symbolIndex + symbol.length)}
        </>
      )}
    </div>
  )
}
