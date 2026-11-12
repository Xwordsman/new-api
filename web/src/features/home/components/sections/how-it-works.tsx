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
import { ArrowRight, Check, Code2, KeyRound, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'

import { UsageIllustration } from '../product-preview'

export function HowItWorks() {
  const { t } = useTranslation()
  const steps = [
    {
      title: t('Create your account'),
      description: t('Open your workspace and get ready to build.'),
      visual: (
        <div className='home-step-form'>
          <UserRound className='text-primary size-5' aria-hidden />
          <div />
          <div />
          <span>
            <Check className='size-3.5' aria-hidden />
            {t('Your workspace awaits')}
          </span>
        </div>
      ),
    },
    {
      title: t('Configure your key'),
      description: t('Create an API key and choose an available model.'),
      visual: (
        <div className='home-step-config'>
          <KeyRound className='text-primary size-5' aria-hidden />
          <code>
            API_KEY=sk-••••••••
            <br />
            BASE_URL=/v1
          </code>
        </div>
      ),
    },
    {
      title: t('Make your first call'),
      description: t(
        'Update your base URL and call the API with your existing tools.'
      ),
      visual: (
        <div className='home-step-response'>
          <Code2 className='text-primary size-5' aria-hidden />
          <code>
            <span>response</span>
            <br />
            {'{ "content": "Hello!" }'}
          </code>
          <span className='home-step-response-line' />
        </div>
      ),
    },
    {
      title: t('See the full picture'),
      description: t('Review requests, token usage and costs in your console.'),
      visual: (
        <div className='home-step-chart'>
          <UsageIllustration />
        </div>
      ),
    },
  ]

  return (
    <section className='home-section home-workflow'>
      <div className='home-container'>
        <Badge variant='outline' className='home-eyebrow'>
          <span className='home-badge-dot' aria-hidden />
          {t('How It Works')}
        </Badge>
        <h2 className='home-section-title'>
          {t('From an idea')} <em>{t('to your first call.')}</em>
        </h2>
        <p className='home-section-description'>
          {t('A familiar workflow. A much simpler connection.')}
        </p>
        <ol className='home-steps'>
          {steps.map((step, index) => (
            <li key={step.title}>
              <div className='home-step-visual' aria-hidden>
                {step.visual}
              </div>
              <h3>
                <span>0{index + 1}</span>
                {step.title}
              </h3>
              <p>{step.description}</p>
              {index < steps.length - 1 && (
                <span className='home-step-arrow' aria-hidden>
                  <ArrowRight className='size-4' />
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
