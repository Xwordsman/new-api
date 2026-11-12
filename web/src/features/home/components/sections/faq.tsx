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

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'

export function FAQ() {
  const { t } = useTranslation()
  const questions = [
    {
      id: 'start',
      question: t('What can I build with this platform?'),
      answer: t(
        'Connect AI-powered applications, developer tools and automation workflows through a shared API gateway. Browse the model catalog to see what is available on this site.'
      ),
    },
    {
      id: 'tools',
      question: t('Can I keep using my existing tools?'),
      answer: t(
        'Tools that support a custom API base URL can connect using an API key from your console. Choose a compatible model and protocol; availability depends on the configured channels.'
      ),
    },
    {
      id: 'pricing',
      question: t('How do I check model pricing?'),
      answer: t(
        'The model catalog lists the available models and their pricing. Your group and any active discounts can affect the final rate. Review actual request costs in your usage logs.'
      ),
    },
    {
      id: 'keys',
      question: t('Can I create separate keys for different apps?'),
      answer: t(
        'Yes. Create multiple API keys in your console, then configure quotas, expiration dates and model restrictions for each application.'
      ),
    },
    {
      id: 'usage',
      question: t('Where can I see my usage?'),
      answer: t(
        'Your console shows request activity, token usage and costs. Usage logs provide details for individual requests so you can investigate unexpected results.'
      ),
    },
  ]

  return (
    <section id='faq' className='home-section home-faq'>
      <div className='home-container'>
        <div className='home-section-heading-centered'>
          <Badge variant='outline' className='home-eyebrow'>
            <span className='home-badge-dot' aria-hidden />
            {t('FAQ')}
          </Badge>
          <h2 className='home-section-title'>
            {t('A few things')} <em>{t('you might wonder.')}</em>
          </h2>
          <p className='home-section-description'>
            {t('A little clarity before you start building.')}
          </p>
        </div>
        <Accordion defaultValue={['start']} className='home-faq-list'>
          {questions.map((question) => (
            <AccordionItem key={question.id} value={question.id}>
              <AccordionTrigger>{question.question}</AccordionTrigger>
              <AccordionContent>{question.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
