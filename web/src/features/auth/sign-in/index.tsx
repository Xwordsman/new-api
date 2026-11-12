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
import { Link, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'

import { AuthLayout } from '../auth-layout'
import { TermsFooter } from '../components/terms-footer'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { t } = useTranslation()
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const { status } = useStatus()

  return (
    <AuthLayout variant='split'>
      <div className='auth-content'>
        <div className='auth-heading'>
          <h1>{t('Welcome back')}</h1>
          <p>{t('Sign in to your account and pick up where you left off.')}</p>
        </div>

        <UserAuthForm redirectTo={redirect} />

        {!status?.self_use_mode_enabled &&
          status?.register_enabled !== false && (
            <p className='auth-account-link'>
              {t('New here?')} <Link to='/sign-up'>{t('Sign up')}</Link>
            </p>
          )}

        <TermsFooter
          variant='sign-in'
          status={status}
          className='auth-terms-footer'
        />
      </div>
    </AuthLayout>
  )
}
