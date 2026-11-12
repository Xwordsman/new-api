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

export function ProtectionLabel(props: { value: string }) {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    allow: t('Allow'),
    observe: t('Record only'),
    block: t('Block'),
    pending: t('Pending review'),
    confirmed: t('Confirmed violation'),
    false_positive: t('False positive'),
    current: t('Current input'),
    system: t('System instructions'),
    history: t('Conversation history'),
    tool: t('Tool output'),
    upstream: t('Upstream safety code'),
    not_sent: t('Not forwarded'),
    attempted: t('Forwarding attempted'),
    responded: t('Upstream responded'),
    settings: t('Policy updated'),
    release: t('Restriction released'),
    auto_suspend: t('Automatic restriction'),
    false_positive_release: t('Released after false-positive review'),
    body_limit: t('Request body exceeds inspection limit'),
    text_limit: t('Text exceeds inspection limit'),
    binary_media: t('Media is not inspected'),
    binary_or_unknown_content: t('Media or unknown content'),
    unsupported_payload: t('Unsupported request structure'),
    nested_content_limit: t('Content nesting exceeds inspection limit'),
    realtime_uninspected: t('Realtime frames are not inspected'),
  }
  return <span>{labels[props.value] || props.value}</span>
}
