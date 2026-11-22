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

import type { ProtectionEvent } from '../types'

export function ProtectionLabel(props: { value: string }) {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    jailbreak: t('Jailbreak and safety bypass'),
    theft: t('Credential theft and malicious cracking'),
    attack: t('Malicious cyberattacks'),
    sexual: t('Pornography and sexual exploitation'),
    clear: t('No risk detected'),
    violation: t('Clear violation'),
    rule_match: t('Custom rule match'),
    keyword_match: t('Keyword match'),
    keyword_suspend: t('Immediate keyword suspension'),
    custom_keyword: t('Custom keyword'),
    review_needed: t('Needs manual review'),
    check_failed: t('Inspection failed'),
    upstream_refusal: t('Upstream refusal'),
    legacy_event: t('Legacy event'),
    custom_rule: t('Custom local rule matched'),
    incomplete_input: t('Input could not be fully inspected'),
    ambiguous_intent: t('Intent is uncertain'),
    harmful_jailbreak: t('Instructions to bypass safety controls'),
    harmful_theft: t('Malicious cracking or credential theft request'),
    harmful_attack: t('Operational malicious attack request'),
    harmful_sexual: t('Explicit pornography or sexual exploitation request'),
    reviewer_unavailable: t('Review service unavailable'),
    reviewer_busy: t('Review service busy'),
    reviewer_not_independent: t(
      'Review channel must use a separate provider host'
    ),
    invalid_review: t('Review response is incomplete or invalid'),
    upstream_signal: t(
      'Upstream reported a safety refusal; no violation penalty'
    ),
    manual_hold: t('User paused by administrator'),
    allow: t('Allow'),
    observe: t('Record only'),
    block: t('Block'),
    hold: t('Safety hold pending review'),
    safety_hold: t('Safety hold pending review'),
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
  return <span>{labels[props.value] || props.value || '—'}</span>
}

export function SuspectedIntent(props: { event: ProtectionEvent }) {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    jailbreak: t('Safety bypass'),
    prompt_extraction: t('System prompt extraction'),
    cyber_attack: t('Malicious cyberattacks'),
    attack: t('Malicious cyberattacks'),
    malware: t('Malware creation'),
    credential_theft: t('Credential theft'),
    theft: t('Credential theft'),
    fraud: t('Fraud'),
    sexual: t('Explicit sexual content'),
    minor_sexual: t('Sexual exploitation of minors'),
    violence: t('Violent harm'),
    custom_keyword: t('Custom keyword'),
  }
  const categories = [
    ...new Set(
      props.event.matches
        .map((hit) => hit.category)
        .filter((category): category is string => Boolean(category))
    ),
  ]
  const description = categories
    .map((category) => labels[category] || category)
    .join(' · ')
  if (!description) {
    if (
      props.event.matches.length === 0 &&
      (props.event.uninspected ||
        props.event.finding === 'check_failed' ||
        props.event.reason === 'incomplete_input')
    ) {
      return <span>{t('No violation intent conclusion')}</span>
    }
    return <ProtectionLabel value={props.event.reason || props.event.finding} />
  }
  return (
    <span>
      {props.event.matches.some((hit) => hit.rule_id === 'semantic_review')
        ? t('Suspected: {{intent}} (semantic review)', { intent: description })
        : t('Suspected: {{intent}} (rule inference)', { intent: description })}
    </span>
  )
}
