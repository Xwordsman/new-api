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
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Edit, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  getCustomNavItems,
  createCustomNavItem,
  updateCustomNavItem,
  deleteCustomNavItem,
  toggleCustomNavItem,
  type CustomNavItem,
  type CustomNavItemInput,
} from './api'

export function CustomNavManagement() {
  const { t } = useTranslation()
  const [items, setItems] = useState<CustomNavItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<CustomNavItem | null>(null)
  const [formData, setFormData] = useState<CustomNavItemInput>({
    name: '',
    url: '',
    enabled: true,
    sort: 0,
    open_new_tab: true,
  })

  useEffect(() => {
    loadItems()
  }, [])

  const loadItems = async () => {
    try {
      const res = await getCustomNavItems(false)
      if (res.success) {
        setItems(res.data)
      }
    } catch (error) {
      toast.error(t('Failed to load custom navigation items'))
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingItem(null)
    setFormData({
      name: '',
      url: '',
      enabled: true,
      sort: 0,
      open_new_tab: true,
    })
    setDialogOpen(true)
  }

  const handleEdit = (item: CustomNavItem) => {
    setEditingItem(item)
    setFormData({
      name: item.name,
      url: item.url,
      enabled: item.enabled,
      sort: item.sort,
      open_new_tab: item.open_new_tab,
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formData.name || !formData.url) {
      toast.error(t('Name and URL are required'))
      return
    }

    try {
      if (editingItem) {
        const res = await updateCustomNavItem({ ...formData, id: editingItem.id, created_time: editingItem.created_time })
        if (res.success) {
          toast.success(t('Updated successfully'))
          loadItems()
          setDialogOpen(false)
        }
      } else {
        const res = await createCustomNavItem(formData)
        if (res.success) {
          toast.success(t('Created successfully'))
          loadItems()
          setDialogOpen(false)
        }
      }
    } catch (error) {
      toast.error(t('Operation failed'))
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t('Are you sure you want to delete this item?'))) {
      return
    }

    try {
      const res = await deleteCustomNavItem(id)
      if (res.success) {
        toast.success(t('Deleted successfully'))
        loadItems()
      }
    } catch (error) {
      toast.error(t('Failed to delete'))
    }
  }

  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      const res = await toggleCustomNavItem(id, enabled)
      if (res.success) {
        toast.success(t('Updated successfully'))
        loadItems()
      }
    } catch (error) {
      toast.error(t('Failed to update'))
    }
  }

  if (loading) {
    return <div>{t('Loading...')}</div>
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h2 className='text-2xl font-bold'>{t('Custom Navigation')}</h2>
        <Button onClick={handleAdd}>
          <Plus className='mr-2 h-4 w-4' />
          {t('Add')}
        </Button>
      </div>

      <div className='border rounded-lg'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Name')}</TableHead>
              <TableHead>{t('URL')}</TableHead>
              <TableHead>{t('Sort')}</TableHead>
              <TableHead>{t('Open in New Tab')}</TableHead>
              <TableHead>{t('Enabled')}</TableHead>
              <TableHead>{t('Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className='text-center text-muted-foreground'>
                  {t('No custom navigation items')}
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell className='max-w-xs truncate'>{item.url}</TableCell>
                  <TableCell>{item.sort}</TableCell>
                  <TableCell>
                    {item.open_new_tab ? (
                      <ExternalLink className='h-4 w-4' />
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={item.enabled}
                      onCheckedChange={(checked) => handleToggle(item.id, checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className='flex gap-2'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleEdit(item)}
                      >
                        <Edit className='h-4 w-4' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingItem ? t('Edit Navigation Item') : t('Add Navigation Item')}
            </DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div>
              <Label htmlFor='name'>{t('Name')}</Label>
              <Input
                id='name'
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('Enter navigation name')}
              />
            </div>
            <div>
              <Label htmlFor='url'>{t('URL')}</Label>
              <Input
                id='url'
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder='https://example.com'
              />
            </div>
            <div>
              <Label htmlFor='sort'>{t('Sort Order')}</Label>
              <Input
                id='sort'
                type='number'
                value={formData.sort}
                onChange={(e) =>
                  setFormData({ ...formData, sort: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div className='flex items-center space-x-2'>
              <Switch
                id='open_new_tab'
                checked={formData.open_new_tab}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, open_new_tab: checked })
                }
              />
              <Label htmlFor='open_new_tab'>{t('Open in New Tab')}</Label>
            </div>
            <div className='flex items-center space-x-2'>
              <Switch
                id='enabled'
                checked={formData.enabled}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, enabled: checked })
                }
              />
              <Label htmlFor='enabled'>{t('Enabled')}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDialogOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button onClick={handleSave}>{t('Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
