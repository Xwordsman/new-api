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
import { readFileSync } from 'node:fs'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, type Mock, test, vi } from 'vitest'

import { PasswordInput } from '@/components/password-input'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { SignIn } from '../sign-in'
import { UserAuthForm } from '../sign-in/components/user-auth-form'
import { SignUp } from '../sign-up'
import { SignUpForm } from '../sign-up/components/sign-up-form'
import type { ApiResponse, LoginResponse, SystemStatus } from '../types'

type TurnstileCallbacks = {
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

const initialSystemConfig = useSystemConfigStore.getState()
const exactPassword = `  密碼✨${'p'.repeat(70)}  `
let client: QueryClient
let widgets: TurnstileCallbacks[]
let removeWidget: Mock<(widgetId: string) => void>
let stylesheet: HTMLStyleElement

function SignInFormHarness() {
  return <UserAuthForm redirectTo='/pricing?view=grid' />
}

async function renderAuthForm(
  page: 'sign-in' | 'sign-up',
  status: SystemStatus,
  completePage = false
) {
  client.setQueryData(STATUS_QUERY_KEY, status)
  const root = createRootRoute({ component: Outlet })
  const auth = createRoute({
    getParentRoute: () => root,
    id: '(auth)',
    component: Outlet,
  })
  const signIn = createRoute({
    getParentRoute: () => auth,
    path: '/sign-in',
    component: completePage ? SignIn : SignInFormHarness,
    validateSearch: () => ({ redirect: '/pricing?view=grid' }),
  })
  const signUp = createRoute({
    getParentRoute: () => auth,
    path: '/sign-up',
    component: completePage ? SignUp : SignUpForm,
  })
  const router = createRouter({
    routeTree: root.addChildren([
      auth.addChildren([signIn, signUp]),
      createRoute({
        getParentRoute: () => root,
        path: '/otp',
        component: () => <p>Additional verification required</p>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/pricing',
        component: () => <p>Pricing destination</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/${page}`] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

function currentWidget() {
  const widget = widgets.at(-1)
  if (!widget) throw new Error('Expected the configured human check widget')
  return widget
}

function pendingResponse<T>() {
  let resolve!: (response: { data: T }) => void
  const promise = new Promise<{ data: T }>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

beforeEach(() => {
  stylesheet = document.createElement('style')
  stylesheet.textContent = readFileSync('src/styles/auth.css', 'utf8')
  document.head.append(stylesheet)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  useAuthStore.getState().auth.reset('complete')
  useSystemConfigStore.getState().setLoading(false)
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(window, 'open').mockImplementation(() => null)
  widgets = []
  removeWidget = vi.fn<(widgetId: string) => void>()
  window.turnstile = {
    render: (_element, options) => {
      widgets.push(options as TurnstileCallbacks)
      return `widget-${widgets.length}`
    },
    remove: removeWidget,
  }
})

afterEach(() => {
  cleanup()
  stylesheet.remove()
  client.clear()
  useAuthStore.getState().auth.reset('idle')
  useSystemConfigStore.setState(initialSystemConfig)
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  delete window.turnstile
  document.querySelector('#cf-turnstile')?.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test.each(['sign-in', 'sign-up'] as const)(
  'keeps %s inputs at 48px and preserves error styling after invalid submission',
  async (page) => {
    await renderAuthForm(
      page,
      {
        registration_email_verification: true,
        oauth_register_enabled: false,
      },
      true
    )
    const user = userEvent.setup()
    const usernameLabel = page === 'sign-in' ? 'Username or Email' : 'Username'
    const username = await screen.findByLabelText(usernameLabel)
    const password = screen.getByLabelText('Password')
    const inputs = [username, password]
    if (page === 'sign-up') {
      inputs.push(
        screen.getByLabelText('Confirm password'),
        screen.getByLabelText('Email (required for verification)'),
        screen.getByLabelText('Verification code')
      )
    }
    for (const input of inputs) {
      expect(getComputedStyle(input).height).toBe('48px')
    }
    for (const name of [usernameLabel, 'Password']) {
      const label = screen.getByText(name, { selector: 'label' })
      expect(getComputedStyle(label).color).toBe('var(--foreground)')
    }

    await user.click(
      screen.getByRole('button', {
        name: page === 'sign-in' ? 'Sign in' : 'Create account',
      })
    )
    await waitFor(() => {
      for (const input of [username, password]) {
        expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(getComputedStyle(input).height).toBe('48px')
        const label = screen.getByText(
          input === username ? usernameLabel : 'Password',
          { selector: 'label' }
        )
        expect(getComputedStyle(label).color).toBe('var(--destructive)')
        expect(input).toHaveAccessibleDescription()
      }
    })
  }
)

test('keeps login consent and human verification gates before submitting exact credentials to additional verification', async () => {
  const pending = pendingResponse<LoginResponse>()
  const post = vi.spyOn(api, 'post').mockReturnValue(pending.promise)
  const router = await renderAuthForm('sign-in', {
    user_agreement_enabled: true,
    privacy_policy_enabled: true,
    github_oauth: true,
    github_client_id: 'configured-client',
    turnstile_check: true,
    turnstile_site_key: 'public-site-key',
  })
  const user = userEvent.setup()
  const username = await screen.findByLabelText('Username or Email')
  const password = screen.getByLabelText('Password')
  const submit = screen.getByRole('button', { name: 'Sign in' })
  const github = screen.getByRole('button', { name: /Continue with GitHub$/ })
  expect(username).toHaveAttribute('autocomplete', 'username')
  expect(password).toHaveAttribute('autocomplete', 'current-password')
  expect(password).toHaveAttribute('type', 'password')
  expect(
    screen.getByRole('link', { name: 'Forgot password?' })
  ).toHaveAttribute('href', '/forgot-password')
  await user.type(username, 'member@example.com')
  await user.click(password)
  await user.paste(exactPassword)
  expect(password).toHaveValue(exactPassword)
  const showPassword = screen.getByRole('button', { name: 'Show password' })
  expect(showPassword).toHaveAttribute('aria-pressed', 'false')
  await user.click(showPassword)
  expect(password).toHaveAttribute('type', 'text')
  expect(password).toHaveValue(exactPassword)
  const hidePassword = screen.getByRole('button', { name: 'Hide password' })
  expect(hidePassword).toHaveAttribute('aria-pressed', 'true')
  await user.click(hidePassword)
  expect(password).toHaveAttribute('type', 'password')
  expect(password).toHaveValue(exactPassword)
  expect(showPassword).toHaveAttribute('aria-pressed', 'false')
  expect(github).toBeDisabled()
  await user.click(github)
  await user.click(submit)
  expect(post).not.toHaveBeenCalled()
  await user.click(screen.getByRole('checkbox'))
  expect(github).toBeEnabled()
  await user.click(submit)
  expect(post).not.toHaveBeenCalled()

  act(() => currentWidget().callback('login-proof'))
  await user.dblClick(submit)
  expect(post).toHaveBeenCalledOnce()
  expect(post).toHaveBeenCalledWith(
    '/api/user/login?turnstile=login-proof',
    { username: 'member@example.com', password: exactPassword },
    { skipAuthRefresh: true }
  )
  expect(submit).toBeDisabled()
  expect(removeWidget).toHaveBeenCalledWith('widget-1')
  expect(useAuthStore.getState().auth.user).toBeNull()
  await act(async () => {
    pending.resolve({
      data: {
        success: true,
        message: '',
        data: {
          require_verification: true,
          flow_token: 'additional-verification-flow',
          expires_at: Math.floor(Date.now() / 1000) + 300,
          methods: [{ method: '2fa', available: true }],
        },
      },
    })
    await pending.promise
  })
  await waitFor(() => expect(router.state.location.pathname).toBe('/otp'))
  expect(useAuthStore.getState().auth.user).toBeNull()
  expect(
    useAuthStore.getState().auth.pendingLoginVerification?.redirectTo
  ).toBe('/pricing?view=grid')
})

test('prevents disabled password visibility actions without changing the password value', async () => {
  const user = userEvent.setup()
  const { rerender } = render(
    <PasswordInput
      aria-label='Protected password'
      defaultValue={exactPassword}
      disabled
    />
  )
  const password = screen.getByLabelText('Protected password')
  const showPassword = screen.getByRole('button', { name: 'Show password' })
  expect(password).toBeDisabled()
  expect(showPassword).toBeDisabled()
  await user.click(showPassword)
  expect(password).toHaveAttribute('type', 'password')
  expect(password).toHaveValue(exactPassword)
  expect(showPassword).toHaveAttribute('aria-pressed', 'false')

  rerender(
    <PasswordInput
      aria-label='Protected password'
      defaultValue={exactPassword}
    />
  )
  await user.click(showPassword)
  rerender(
    <PasswordInput
      aria-label='Protected password'
      defaultValue={exactPassword}
      disabled
    />
  )
  const hidePassword = screen.getByRole('button', { name: 'Hide password' })
  expect(hidePassword).toBeDisabled()
  await user.click(hidePassword)
  expect(password).toHaveAttribute('type', 'text')
  expect(password).toHaveValue(exactPassword)
  expect(hidePassword).toHaveAttribute('aria-pressed', 'true')
})

test('requires risk-configured email, code and invitation and keeps referral and password values intact', async () => {
  window.history.replaceState({}, '', '/sign-up?aff=%20referral-code%20')
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'Failed to create account' },
  })
  await renderAuthForm('sign-up', {
    email_verification: false,
    turnstile_check: false,
    registration_email_verification: true,
    registration_turnstile_check: true,
    invitation_registration_enabled: true,
    turnstile_site_key: 'public-site-key',
    user_agreement_enabled: true,
    oauth_register_enabled: false,
  })
  const user = userEvent.setup()
  const username = await screen.findByLabelText('Username')
  const password = screen.getByLabelText('Password')
  const confirmation = screen.getByLabelText('Confirm password')
  const email = screen.getByLabelText('Email (required for verification)')
  const code = screen.getByLabelText('Verification code')
  const invitation = screen.getByLabelText('Invitation Code')
  const submit = screen.getByRole('button', { name: 'Create account' })
  expect(username).toHaveAttribute('autocomplete', 'username')
  expect(email).toHaveAttribute('autocomplete', 'email')
  expect(password).toHaveAttribute('autocomplete', 'new-password')
  expect(confirmation).toHaveAttribute('autocomplete', 'new-password')
  expect(password).toHaveAttribute('type', 'password')
  expect(confirmation).toHaveAttribute('type', 'password')
  expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  expect(submit).toBeDisabled()
  await user.type(username, 'invited-member')
  await user.click(password)
  await user.paste(exactPassword)
  await user.click(confirmation)
  await user.paste(exactPassword)
  await user.click(screen.getByRole('checkbox'))
  expect(submit).toBeDisabled()
  act(() => currentWidget().callback('registration-proof'))
  expect(submit).toBeEnabled()
  act(() => currentWidget()['expired-callback']())
  expect(submit).toBeDisabled()
  act(() => currentWidget().callback('fresh-registration-proof'))

  await user.click(submit)
  expect(post).not.toHaveBeenCalled()
  await user.type(email, 'member@example.com')
  await user.click(submit)
  expect(post).not.toHaveBeenCalled()
  await user.type(code, '123456')
  await user.click(submit)
  expect(
    await screen.findByText('Please enter an invitation code')
  ).toBeVisible()
  expect(post).not.toHaveBeenCalled()
  await user.type(invitation, '  invitation-code  ')
  await user.click(submit)
  await waitFor(() => expect(post).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledWith(
    '/api/user/register',
    {
      username: 'invited-member',
      password: exactPassword,
      email: 'member@example.com',
      verification_code: '123456',
      aff_code: 'referral-code',
      invitation_code: 'invitation-code',
      turnstile: 'fresh-registration-proof',
    },
    { params: { turnstile: 'fresh-registration-proof' } }
  )
  await waitFor(() => expect(submit).toBeDisabled())
  expect(removeWidget).toHaveBeenCalledWith('widget-1')
  expect(password).toHaveValue(exactPassword)
  expect(useAuthStore.getState().auth.user).toBeNull()
})

test('honors the server email cooldown and consumes the human check before another email attempt', async () => {
  const pending = pendingResponse<ApiResponse<{ retry_after: number }>>()
  const get = vi.spyOn(api, 'get').mockReturnValue(pending.promise)
  await renderAuthForm('sign-up', {
    registration_email_verification: true,
    registration_turnstile_check: true,
    turnstile_site_key: 'public-site-key',
  })
  const user = userEvent.setup()
  const email = await screen.findByLabelText(
    'Email (required for verification)'
  )
  const send = screen.getByRole('button', { name: 'Send code' })
  await user.type(email, 'member@example.com')
  expect(send).toBeDisabled()
  act(() => currentWidget().callback('email-proof'))
  await user.dblClick(send)
  expect(get).toHaveBeenCalledOnce()
  expect(get).toHaveBeenCalledWith('/api/verification', {
    params: { email: 'member@example.com', turnstile: 'email-proof' },
  })
  expect(screen.getByRole('button', { name: 'Send code' })).toBeDisabled()

  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  await act(async () => {
    pending.resolve({
      data: { success: true, message: '', data: { retry_after: 7 } },
    })
    await pending.promise
  })
  expect(screen.getByRole('button', { name: 'Resend (7s)' })).toBeDisabled()
  expect(removeWidget).toHaveBeenCalledWith('widget-1')
  act(() => currentWidget().callback('renewed-email-proof'))
  act(() => vi.advanceTimersByTime(6000))
  expect(screen.getByRole('button', { name: 'Resend (1s)' })).toBeDisabled()
  act(() => currentWidget()['error-callback']())
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByRole('button', { name: 'Send code' })).toBeDisabled()
  act(() => currentWidget().callback('valid-email-proof'))
  expect(screen.getByRole('button', { name: 'Send code' })).toBeEnabled()
  expect(get).toHaveBeenCalledOnce()
})

test('respects disabled password login and signup while keeping configured alternatives available', async () => {
  const status: SystemStatus = {
    password_login_enabled: false,
    register_enabled: true,
    passkey_login: true,
    github_oauth: true,
  }
  await renderAuthForm('sign-in', status, true)
  expect(
    await screen.findByRole('button', { name: 'Sign in with Passkey' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: /Continue with GitHub$/ })
  ).toBeVisible()
  expect(screen.queryByLabelText('Username or Email')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Sign in' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Sign up' })).toBeVisible()

  await act(async () => {
    client.setQueryData(STATUS_QUERY_KEY, {
      ...status,
      password_login_enabled: true,
      register_enabled: false,
    })
  })
  expect(await screen.findByLabelText('Username or Email')).toBeVisible()
  expect(screen.getByLabelText('Password')).toBeVisible()
  expect(
    screen.queryByRole('link', { name: 'Sign up' })
  ).not.toBeInTheDocument()
  await act(async () => {
    client.setQueryData(STATUS_QUERY_KEY, {
      ...status,
      password_login_enabled: true,
      self_use_mode_enabled: true,
      github_oauth: false,
    })
  })
  await waitFor(() => {
    expect(
      screen.queryByRole('link', { name: 'Sign up' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Continue with GitHub$/ })
    ).not.toBeInTheDocument()
  })
  expect(
    screen.getByRole('button', { name: 'Sign in with Passkey' })
  ).toBeVisible()
})

test('hides disabled OAuth registration and requires legal consent when the method is enabled', async () => {
  const post = vi.spyOn(api, 'post')
  const status: SystemStatus = {
    github_oauth: true,
    github_client_id: 'configured-client',
    oauth_register_enabled: false,
    privacy_policy_enabled: true,
  }
  await renderAuthForm('sign-up', status)
  await screen.findByRole('button', { name: 'Create account' })
  expect(
    screen.queryByRole('button', { name: /Continue with GitHub$/ })
  ).not.toBeInTheDocument()
  await act(async () => {
    client.setQueryData(STATUS_QUERY_KEY, {
      ...status,
      oauth_register_enabled: true,
    })
  })
  const user = userEvent.setup()
  const github = await screen.findByRole('button', {
    name: /Continue with GitHub$/,
  })
  expect(github).toBeDisabled()
  await user.click(github)
  expect(post).not.toHaveBeenCalled()
  expect(window.open).not.toHaveBeenCalled()
  await user.click(screen.getByRole('checkbox'))
  expect(github).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
})
