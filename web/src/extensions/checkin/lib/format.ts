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
// Payment currencies are independent from the wallet display currency.
export function formatCheckinPayment(
  amount: string,
  currency: string,
  locale: string | undefined
) {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return '—'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 6,
    }).format(numeric)
  } catch {
    return `${amount} ${currency}`
  }
}

// Dates from the server are civil dates in its configured check-in time zone.
export function checkinCalendarDate(value: string) {
  const [year, month, day = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

export function checkinDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
