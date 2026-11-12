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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  PromptInput,
  PromptInputAttachments,
  PromptInputProvider,
  type PromptInputProps,
  PromptInputSubmit,
  PromptInputTextarea,
} from '../prompt-input'

function InputFixture(
  props: Pick<PromptInputProps, 'onSubmit' | 'onError'> & { provider?: boolean }
) {
  const input = (
    <PromptInput onSubmit={props.onSubmit} onError={props.onError} multiple>
      <PromptInputTextarea aria-label='Message' />
      <input aria-label='Subject' name='subject' defaultValue='Report' />
      <PromptInputAttachments>
        {(file) => <span>{file.filename}</span>}
      </PromptInputAttachments>
      <PromptInputSubmit />
    </PromptInput>
  )
  return props.provider ? (
    <PromptInputProvider>{input}</PromptInputProvider>
  ) : (
    input
  )
}

const revokedUrls = new Set<string>()

beforeEach(() => {
  revokedUrls.clear()
  let nextUrl = 0
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        nextUrl += 1
        return `blob:report-${nextUrl}`
      }
      static revokeObjectURL(url: string) {
        revokedUrls.add(url)
      }
    }
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (revokedUrls.has(url)) {
        throw new TypeError('Blob URL was revoked')
      }
      return {
        ok: true,
        blob: async () => new Blob(['report'], { type: 'text/plain' }),
      }
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('reports attachment fetch failure and retains the message and file for retry', async () => {
  const onSubmit = vi.fn()
  const onError = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new TypeError('Read failed'))
  )
  render(<InputFixture onSubmit={onSubmit} onError={onError} />)
  const message = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.change(message, { target: { value: 'Please read the report' } })
  fireEvent.change(screen.getByLabelText('Upload files'), {
    target: {
      files: [new File(['report'], 'report.txt', { type: 'text/plain' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

  await waitFor(() =>
    expect(onError).toHaveBeenCalledWith({
      code: 'attachment_read',
      message: 'Unable to read attachments. Please try again.',
    })
  )
  expect(onSubmit).not.toHaveBeenCalled()
  expect(message).toHaveValue('Please read the report')
  expect(screen.getByText('report.txt')).toBeInTheDocument()
})

it('keeps earlier blob attachments readable when another file is added', async () => {
  const onSubmit = vi.fn()
  render(<InputFixture onSubmit={onSubmit} />)
  const upload = screen.getByLabelText('Upload files')
  fireEvent.change(upload, {
    target: {
      files: [new File(['report'], 'report.txt', { type: 'text/plain' })],
    },
  })
  fireEvent.change(upload, {
    target: {
      files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  expect(onSubmit.mock.calls[0][0].files).toEqual([
    expect.objectContaining({
      filename: 'report.txt',
      url: 'data:text/plain;base64,cmVwb3J0',
    }),
    expect.objectContaining({
      filename: 'notes.txt',
      url: 'data:text/plain;base64,cmVwb3J0',
    }),
  ])
})

it('reports an unsuccessful attachment response without submitting its contents', async () => {
  const onSubmit = vi.fn()
  const onError = vi.fn()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  render(<InputFixture onSubmit={onSubmit} onError={onError} />)
  fireEvent.change(screen.getByLabelText('Upload files'), {
    target: { files: [new File(['report'], 'report.txt')] },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

  await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
  expect(onSubmit).not.toHaveBeenCalled()
  expect(screen.getByText('report.txt')).toBeInTheDocument()
})

it.each(['error', 'abort'] as const)(
  'shows the shared error toast when attachment reading emits %s and no error callback is provided',
  async (eventType) => {
    const onSubmit = vi.fn()
    const errorToast = vi.spyOn(toast, 'error').mockReturnValue(0)
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(
      function (this: FileReader) {
        this.dispatchEvent(new ProgressEvent(eventType))
        this.dispatchEvent(new ProgressEvent('loadend'))
      }
    )
    render(<InputFixture onSubmit={onSubmit} provider />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Please read the report' },
    })
    fireEvent.change(screen.getByLabelText('Upload files'), {
      target: { files: [new File(['report'], 'report.txt')] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        'Unable to read attachments. Please try again.'
      )
    )
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
      'Please read the report'
    )
    expect(screen.getByText('report.txt')).toBeInTheDocument()
  }
)

it('rejects a completed attachment read without a data URL', async () => {
  const onSubmit = vi.fn()
  const onError = vi.fn()
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
    this: FileReader
  ) {
    this.dispatchEvent(new ProgressEvent('load'))
    this.dispatchEvent(new ProgressEvent('loadend'))
  })
  render(<InputFixture onSubmit={onSubmit} onError={onError} />)
  fireEvent.change(screen.getByLabelText('Upload files'), {
    target: { files: [new File(['report'], 'report.txt')] },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

  await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
  expect(onSubmit).not.toHaveBeenCalled()
})

it.each([false, true])(
  'clears a successfully submitted message and files without resetting other fields (provider=%s)',
  async (provider) => {
    const onSubmit = vi.fn()
    render(<InputFixture onSubmit={onSubmit} provider={provider} />)
    const message = screen.getByRole('textbox', { name: 'Message' })
    const subject = screen.getByRole('textbox', { name: 'Subject' })
    fireEvent.change(message, { target: { value: 'Please read the report' } })
    fireEvent.change(subject, { target: { value: 'Changed subject' } })
    fireEvent.change(screen.getByLabelText('Upload files'), {
      target: {
        files: [new File(['report'], 'report.txt', { type: 'text/plain' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(message).toHaveValue(''))
    expect(onSubmit).toHaveBeenCalledWith(
      {
        text: 'Please read the report',
        files: [
          expect.objectContaining({ url: 'data:text/plain;base64,cmVwb3J0' }),
        ],
      },
      expect.anything()
    )
    expect(screen.queryByText('report.txt')).not.toBeInTheDocument()
    expect(subject).toHaveValue('Changed subject')
  }
)

it.each(['sync', 'async'] as const)(
  'retains the message and files when the %s submit callback fails',
  async (failureType) => {
    const failed = new Error('Submission failed')
    const onSubmit = vi.fn(() => {
      if (failureType === 'sync') {
        throw failed
      }
      return Promise.reject(failed)
    })
    const onError = vi.fn()
    const errorToast = vi.spyOn(toast, 'error').mockReturnValue(0)
    render(<InputFixture onSubmit={onSubmit} onError={onError} />)
    const message = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(message, { target: { value: 'Please read the report' } })
    fireEvent.change(screen.getByLabelText('Upload files'), {
      target: { files: [new File(['report'], 'report.txt')] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(message).toHaveValue('Please read the report')
    expect(screen.getByText('report.txt')).toBeInTheDocument()
    expect(onError).not.toHaveBeenCalled()
    expect(errorToast).not.toHaveBeenCalled()
  }
)

it.each([false, true])(
  'preserves new text and files entered while conversion is pending and ignores duplicate submission (provider=%s)',
  async (provider) => {
    let resolveBlob!: (blob: Blob) => void
    const pendingBlob = new Promise<Blob>((resolve) => {
      resolveBlob = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: () => pendingBlob })
    )
    const onSubmit = vi.fn()
    render(<InputFixture onSubmit={onSubmit} provider={provider} />)
    const message = screen.getByRole('textbox', { name: 'Message' })
    const upload = screen.getByLabelText('Upload files')
    fireEvent.change(message, { target: { value: 'First message' } })
    fireEvent.change(upload, {
      target: {
        files: [new File(['report'], 'report.txt', { type: 'text/plain' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    fireEvent.change(message, { target: { value: 'New draft' } })
    fireEvent.change(upload, {
      target: {
        files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })],
      },
    })

    await act(async () =>
      resolveBlob(new Blob(['report'], { type: 'text/plain' }))
    )
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByText('report.txt')).not.toBeInTheDocument()
    )
    expect(onSubmit.mock.calls[0][0].text).toBe('First message')
    expect(message).toHaveValue('New draft')
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(revokedUrls.has('blob:report-2')).toBe(false)
  }
)

it.each([false, true])(
  'preserves new text and files entered while submission is pending (provider=%s)',
  async (provider) => {
    let resolveSubmission!: () => void
    const pendingSubmission = new Promise<void>((resolve) => {
      resolveSubmission = resolve
    })
    const onSubmit = vi.fn<PromptInputProps['onSubmit']>(
      () => pendingSubmission
    )
    render(<InputFixture onSubmit={onSubmit} provider={provider} />)
    const message = screen.getByRole('textbox', { name: 'Message' })
    const upload = screen.getByLabelText('Upload files')
    fireEvent.change(message, { target: { value: 'First message' } })
    fireEvent.change(upload, {
      target: {
        files: [new File(['report'], 'report.txt', { type: 'text/plain' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    fireEvent.change(message, { target: { value: 'New draft' } })
    fireEvent.change(upload, {
      target: {
        files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await act(async () => resolveSubmission())

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'First message' }),
      expect.anything()
    )
    expect(message).toHaveValue('New draft')
    expect(screen.queryByText('report.txt')).not.toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(revokedUrls.has('blob:report-2')).toBe(false)
  }
)

it('releases removed and unmounted local files without revoking retained attachments', () => {
  const { unmount } = render(<InputFixture onSubmit={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Upload files'), {
    target: {
      files: [
        new File(['report'], 'report.txt'),
        new File(['notes'], 'notes.txt'),
      ],
    },
  })

  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), {
    key: 'Backspace',
  })

  expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
  expect(screen.getByText('report.txt')).toBeInTheDocument()
  expect(revokedUrls.has('blob:report-2')).toBe(true)
  expect(revokedUrls.has('blob:report-1')).toBe(false)

  unmount()

  expect(revokedUrls.has('blob:report-1')).toBe(true)
})

it('allows retrying the retained attachment after a failed conversion', async () => {
  const onSubmit = vi.fn()
  const onError = vi.fn()
  const attachmentFetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Read failed'))
    .mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['report'], { type: 'text/plain' }),
    })
  vi.stubGlobal('fetch', attachmentFetch)
  render(<InputFixture onSubmit={onSubmit} onError={onError} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Please read the report' },
  })
  fireEvent.change(screen.getByLabelText('Upload files'), {
    target: {
      files: [new File(['report'], 'report.txt', { type: 'text/plain' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  expect(onSubmit.mock.calls[0][0].text).toBe('Please read the report')
  expect(screen.queryByText('report.txt')).not.toBeInTheDocument()
})
