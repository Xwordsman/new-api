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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Power,
  Search,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import dayjs from '@/lib/dayjs'

import {
  createInvitationCodes,
  deleteInvitationCode,
  getInvitationCodes,
  updateInvitationCode,
} from './api'
import type { InvitationCode } from './types'

const PAGE_SIZE = 20

type CodeFormValues = {
  name: string
  code: string
  prefix: string
  count: number
  maxUses: number
  expiresAt: string
}

const emptyFormValues: CodeFormValues = {
  name: '',
  code: '',
  prefix: '',
  count: 1,
  maxUses: 1,
  expiresAt: '',
}

export function InvitationCodesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const codeFormSchema = useMemo(
    () =>
      z.object({
        name: z.string().max(100, t('Name must be at most 100 characters')),
        code: z
          .string()
          .max(64, t('Invitation code must be at most 64 characters')),
        prefix: z.string().max(16, t('Prefix must be at most 16 characters')),
        count: z
          .number()
          .int()
          .min(1, t('Quantity must be between 1 and 100'))
          .max(100, t('Quantity must be between 1 and 100')),
        maxUses: z
          .number()
          .int()
          .min(0, t('Maximum uses must be between 0 and 1,000,000'))
          .max(1000000, t('Maximum uses must be between 0 and 1,000,000')),
        expiresAt: z.string(),
      }),
    [t]
  )
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCode, setEditingCode] = useState<InvitationCode | null>(null)
  const [deletingCode, setDeletingCode] = useState<InvitationCode | null>(null)

  const codesQuery = useQuery({
    queryKey: ['invitation-extension', 'codes', page, keyword],
    queryFn: () => getInvitationCodes({ page, pageSize: PAGE_SIZE, keyword }),
  })

  const form = useForm<CodeFormValues>({
    resolver: zodResolver(codeFormSchema),
    defaultValues: emptyFormValues,
  })

  const refreshCodes = () =>
    queryClient.invalidateQueries({
      queryKey: ['invitation-extension', 'codes'],
    })

  const createMutation = useMutation({
    mutationFn: createInvitationCodes,
    onSuccess: async (codes) => {
      await refreshCodes()
      setDialogOpen(false)
      toast.success(
        t('{{count}} invitation codes created', { count: codes.length })
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: number
      values: Parameters<typeof updateInvitationCode>[1]
    }) => updateInvitationCode(id, values),
    onSuccess: async () => {
      await refreshCodes()
      setDialogOpen(false)
      toast.success(t('Invitation code updated'))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteInvitationCode,
    onSuccess: async () => {
      await refreshCodes()
      setDeletingCode(null)
      toast.success(t('Invitation code deleted'))
    },
  })

  const openCreateDialog = () => {
    setEditingCode(null)
    form.reset(emptyFormValues)
    setDialogOpen(true)
  }

  const openEditDialog = (code: InvitationCode) => {
    setEditingCode(code)
    form.reset({
      name: code.name,
      code: code.code,
      prefix: '',
      count: 1,
      maxUses: code.max_uses,
      expiresAt: code.expires_at
        ? dayjs(code.expires_at).format('YYYY-MM-DDTHH:mm')
        : '',
    })
    setDialogOpen(true)
  }

  const submitForm = (values: CodeFormValues) => {
    const expiresAt = values.expiresAt
      ? new Date(values.expiresAt).toISOString()
      : null
    if (editingCode) {
      updateMutation.mutate({
        id: editingCode.id,
        values: {
          name: values.name.trim(),
          status: editingCode.status,
          max_uses: values.maxUses,
          expires_at: expiresAt,
        },
      })
      return
    }
    if (values.code.trim() && values.count !== 1) {
      form.setError('count', {
        message: t('Custom codes can only be created one at a time'),
      })
      return
    }
    createMutation.mutate({
      name: values.name.trim(),
      code: values.code.trim() || undefined,
      prefix: values.prefix.trim() || undefined,
      count: values.count,
      max_uses: values.maxUses,
      expires_at: expiresAt,
    })
  }

  const toggleCode = (code: InvitationCode) => {
    updateMutation.mutate({
      id: code.id,
      values: {
        name: code.name,
        status: code.status === 1 ? 0 : 1,
        max_uses: code.max_uses,
        expires_at: code.expires_at,
      },
    })
  }

  const total = codesQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const isMutating = createMutation.isPending || updateMutation.isPending

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Code Management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button onClick={openCreateDialog}>
            <Plus />
            {t('Create Invitation Codes')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col gap-3'>
            <form
              className='flex max-w-md gap-2'
              onSubmit={(event) => {
                event.preventDefault()
                setPage(1)
                setKeyword(searchInput.trim())
              }}
            >
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t('Search code or name')}
              />
              <Button
                type='submit'
                variant='outline'
                size='icon'
                title={t('Search')}
              >
                <Search />
              </Button>
            </form>

            <div className='min-h-0 overflow-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Invitation Code')}</TableHead>
                    <TableHead>{t('Name')}</TableHead>
                    <TableHead>{t('Status')}</TableHead>
                    <TableHead>{t('Usage')}</TableHead>
                    <TableHead>{t('Expires At')}</TableHead>
                    <TableHead>{t('Created At')}</TableHead>
                    <TableHead className='text-right'>{t('Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codesQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className='h-32 text-center'>
                        <Loader2 className='mx-auto animate-spin' />
                      </TableCell>
                    </TableRow>
                  )}
                  {!codesQuery.isLoading &&
                    Boolean(codesQuery.data?.items.length) &&
                    codesQuery.data?.items.map((code) => {
                      const isExpired = Boolean(
                        code.expires_at &&
                        dayjs(code.expires_at).isBefore(dayjs())
                      )
                      const isExhausted =
                        code.max_uses > 0 && code.used_count >= code.max_uses
                      let statusLabel = t('Active')
                      if (code.status === 0) {
                        statusLabel = t('Disabled')
                      } else if (isExpired) {
                        statusLabel = t('Expired')
                      } else if (isExhausted) {
                        statusLabel = t('Exhausted')
                      }
                      const isActive =
                        code.status === 1 && !isExpired && !isExhausted
                      return (
                        <TableRow key={code.id}>
                          <TableCell>
                            <div className='flex items-center gap-1'>
                              <span className='font-mono text-xs'>
                                {code.code}
                              </span>
                              <CopyButton
                                value={code.code}
                                size='icon'
                                className='size-7'
                                tooltip={t('Copy invitation code')}
                              />
                            </div>
                          </TableCell>
                          <TableCell>{code.name || '-'}</TableCell>
                          <TableCell>
                            <Badge
                              variant='outline'
                              className={
                                isActive
                                  ? 'border-emerald-500/40 text-emerald-600'
                                  : 'text-muted-foreground'
                              }
                            >
                              {statusLabel}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {code.used_count} /{' '}
                            {code.max_uses === 0
                              ? t('Unlimited')
                              : code.max_uses}
                          </TableCell>
                          <TableCell>
                            {code.expires_at
                              ? dayjs(code.expires_at).format(
                                  'YYYY-MM-DD HH:mm'
                                )
                              : t('Never')}
                          </TableCell>
                          <TableCell>
                            {dayjs(code.created_at).format('YYYY-MM-DD HH:mm')}
                          </TableCell>
                          <TableCell>
                            <div className='flex justify-end gap-1'>
                              <Button
                                variant='ghost'
                                size='icon-sm'
                                title={
                                  code.status === 1 ? t('Disable') : t('Enable')
                                }
                                onClick={() => toggleCode(code)}
                                disabled={updateMutation.isPending}
                              >
                                <Power />
                              </Button>
                              <Button
                                variant='ghost'
                                size='icon-sm'
                                title={t('Edit')}
                                onClick={() => openEditDialog(code)}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                variant='ghost'
                                size='icon-sm'
                                title={t('Delete')}
                                onClick={() => setDeletingCode(code)}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  {!codesQuery.isLoading && !codesQuery.data?.items.length && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className='text-muted-foreground h-32 text-center'
                      >
                        {t('No invitation codes found')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className='flex items-center justify-between gap-3 text-sm'>
              <span className='text-muted-foreground'>
                {t('{{total}} codes in total', { total })}
              </span>
              <div className='flex items-center gap-2'>
                <Button
                  variant='outline'
                  size='icon-sm'
                  title={t('Previous')}
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft />
                </Button>
                <span>
                  {page} / {pageCount}
                </span>
                <Button
                  variant='outline'
                  size='icon-sm'
                  title={t('Next')}
                  disabled={page >= pageCount}
                  onClick={() =>
                    setPage((current) => Math.min(pageCount, current + 1))
                  }
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>
              {editingCode
                ? t('Edit Invitation Code')
                : t('Create Invitation Codes')}
            </DialogTitle>
            <DialogDescription>
              {editingCode
                ? editingCode.code
                : t('Generate random codes or enter one custom code')}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              id='invitation-code-form'
              onSubmit={form.handleSubmit(submitForm)}
              className='grid gap-4 sm:grid-cols-2'
            >
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem className='sm:col-span-2'>
                    <FormLabel>{t('Name')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('Optional note')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!editingCode && (
                <>
                  <FormField
                    control={form.control}
                    name='code'
                    render={({ field }) => (
                      <FormItem className='sm:col-span-2'>
                        <FormLabel>{t('Custom Invitation Code')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('Leave blank to generate randomly')}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Custom codes use letters, numbers, underscores, or hyphens'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='prefix'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Generated Code Prefix')}</FormLabel>
                        <FormControl>
                          <Input placeholder='VIP' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='count'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Quantity')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={1}
                            max={100}
                            value={field.value}
                            onChange={(event) =>
                              field.onChange(Number(event.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
              <FormField
                control={form.control}
                name='maxUses'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Maximum Uses')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        max={1000000}
                        value={field.value}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Use 0 for unlimited')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='expiresAt'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Expires At')}</FormLabel>
                    <FormControl>
                      <Input type='datetime-local' {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('Leave blank for never')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setDialogOpen(false)}
              disabled={isMutating}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='submit'
              form='invitation-code-form'
              disabled={isMutating}
            >
              {isMutating ? <Loader2 className='animate-spin' /> : null}
              {editingCode ? t('Save') : t('Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingCode)}
        onOpenChange={(open) => !open && setDeletingCode(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Invitation Code')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This action cannot be undone. The invitation code will stop working immediately.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={deleteMutation.isPending}
              onClick={() =>
                deletingCode && deleteMutation.mutate(deletingCode.id)
              }
            >
              {deleteMutation.isPending ? (
                <Loader2 className='animate-spin' />
              ) : null}
              {t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
