/*
Copyright (C) 2025 QuantumNous

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

import React, { useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Card,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { Copy, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { API, showError, showSuccess } from '../../helpers';

const { Text, Title } = Typography;
const PAGE_SIZE = 20;
const emptyForm = {
  name: '',
  code: '',
  prefix: '',
  count: 1,
  max_uses: 1,
  expires_at: null,
};

const InvitationSetting = () => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [codes, setCodes] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingCode, setEditingCode] = useState(null);
  const [formValues, setFormValues] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const loadSettings = async () => {
    const response = await API.get('/api/extensions/invitation/admin/settings');
    const { success, message, data } = response.data;
    if (!success) {
      throw new Error(message);
    }
    setEnabled(!!data.enabled);
  };

  const loadCodes = async () => {
    const response = await API.get('/api/extensions/invitation/admin/codes', {
      params: { p: page, page_size: PAGE_SIZE, keyword: keyword || undefined },
    });
    const { success, message, data } = response.data;
    if (!success) {
      throw new Error(message);
    }
    setCodes(data.items || []);
    setTotal(data.total || 0);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      await Promise.all([loadSettings(), loadCodes()]);
    } catch (error) {
      showError(error.message || t('加载邀请码设置失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [page, keyword]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await API.put(
        '/api/extensions/invitation/admin/settings',
        { enabled },
      );
      const { success, message } = response.data;
      if (!success) {
        showError(message);
        return;
      }
      const statusResponse = await API.get('/api/status');
      if (statusResponse.data?.success && statusResponse.data?.data) {
        localStorage.setItem(
          'status',
          JSON.stringify(statusResponse.data.data),
        );
      }
      showSuccess(t('邀请码设置已保存'));
    } catch (error) {
      showError(t('保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setEditingCode(null);
    setFormValues(emptyForm);
    setModalVisible(true);
  };

  const openEdit = (code) => {
    setEditingCode(code);
    setFormValues({
      name: code.name || '',
      code: code.code,
      prefix: '',
      count: 1,
      max_uses: code.max_uses,
      expires_at: code.expires_at ? new Date(code.expires_at) : null,
    });
    setModalVisible(true);
  };

  const submitCode = async () => {
    if (formValues.count < 1 || formValues.count > 100) {
      showError(t('生成数量必须在 1 到 100 之间'));
      return;
    }
    if (formValues.max_uses < 0) {
      showError(t('最大使用次数不能小于 0'));
      return;
    }
    if (!editingCode && formValues.code.trim() && formValues.count !== 1) {
      showError(t('自定义邀请码每次只能创建一个'));
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: formValues.name.trim(),
        max_uses: formValues.max_uses,
        expires_at: formValues.expires_at
          ? new Date(formValues.expires_at).toISOString()
          : null,
      };
      const response = editingCode
        ? await API.put(
            `/api/extensions/invitation/admin/codes/${editingCode.id}`,
            { ...payload, status: editingCode.status },
          )
        : await API.post('/api/extensions/invitation/admin/codes', {
            ...payload,
            code: formValues.code.trim() || undefined,
            prefix: formValues.prefix.trim() || undefined,
            count: formValues.count,
          });
      const { success, message } = response.data;
      if (!success) {
        showError(message);
        return;
      }
      setModalVisible(false);
      await loadCodes();
      showSuccess(editingCode ? t('邀请码已更新') : t('邀请码已创建'));
    } catch (error) {
      showError(t('操作失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (code) => {
    try {
      const response = await API.put(
        `/api/extensions/invitation/admin/codes/${code.id}`,
        {
          name: code.name,
          status: code.status === 1 ? 0 : 1,
          max_uses: code.max_uses,
          expires_at: code.expires_at,
        },
      );
      const { success, message } = response.data;
      if (!success) {
        showError(message);
        return;
      }
      await loadCodes();
    } catch (error) {
      showError(t('操作失败'));
    }
  };

  const deleteCode = async (id) => {
    try {
      const response = await API.delete(
        `/api/extensions/invitation/admin/codes/${id}`,
      );
      const { success, message } = response.data;
      if (!success) {
        showError(message);
        return;
      }
      await loadCodes();
      showSuccess(t('邀请码已删除'));
    } catch (error) {
      showError(t('删除失败'));
    }
  };

  const columns = [
    {
      title: t('邀请码'),
      dataIndex: 'code',
      render: (value) => (
        <Space spacing={4}>
          <Text code>{value}</Text>
          <Tooltip content={t('复制邀请码')}>
            <Button
              theme='borderless'
              type='tertiary'
              icon={<Copy size={15} />}
              onClick={async () => {
                await navigator.clipboard.writeText(value);
                showSuccess(t('已复制'));
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
    { title: t('名称'), dataIndex: 'name', render: (value) => value || '-' },
    {
      title: t('状态'),
      dataIndex: 'status',
      render: (status, record) => {
        const expired =
          record.expires_at && new Date(record.expires_at) <= new Date();
        const exhausted =
          record.max_uses > 0 && record.used_count >= record.max_uses;
        const label =
          status === 0
            ? t('已禁用')
            : expired
              ? t('已过期')
              : exhausted
                ? t('已用尽')
                : t('可用');
        return (
          <Tag color={label === t('可用') ? 'green' : 'grey'}>{label}</Tag>
        );
      },
    },
    {
      title: t('使用次数'),
      render: (_, record) =>
        `${record.used_count} / ${record.max_uses === 0 ? t('无限') : record.max_uses}`,
    },
    {
      title: t('过期时间'),
      dataIndex: 'expires_at',
      render: (value) =>
        value ? new Date(value).toLocaleString() : t('永不过期'),
    },
    {
      title: t('操作'),
      render: (_, record) => (
        <Space spacing={4}>
          <Tooltip content={record.status === 1 ? t('禁用') : t('启用')}>
            <Button
              theme='borderless'
              type='tertiary'
              icon={<Power size={16} />}
              onClick={() => updateStatus(record)}
            />
          </Tooltip>
          <Tooltip content={t('编辑')}>
            <Button
              theme='borderless'
              type='tertiary'
              icon={<Pencil size={16} />}
              onClick={() => openEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title={t('确定删除这个邀请码吗？')}
            onConfirm={() => deleteCode(record.id)}
          >
            <Tooltip content={t('删除')}>
              <Button
                theme='borderless'
                type='danger'
                icon={<Trash2 size={16} />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Spin spinning={loading} size='large'>
      <div className='flex flex-col gap-4'>
        <Card>
          <div className='flex flex-wrap items-center justify-between gap-4'>
            <div>
              <Title heading={5}>{t('邀请码注册')}</Title>
              <Text type='tertiary'>
                {t('开启后，用户通过密码注册时必须输入有效邀请码')}
              </Text>
            </div>
            <Space>
              <Switch checked={enabled} onChange={setEnabled} />
              <Button type='primary' loading={saving} onClick={saveSettings}>
                {t('保存')}
              </Button>
            </Space>
          </div>
        </Card>

        <Card>
          <div className='flex flex-wrap items-center justify-between gap-3 mb-4'>
            <Space>
              <Input
                value={keywordInput}
                onChange={setKeywordInput}
                placeholder={t('搜索邀请码或名称')}
                suffix={<Search size={16} />}
                onEnterPress={() => {
                  setPage(1);
                  setKeyword(keywordInput.trim());
                }}
              />
              <Button
                onClick={() => {
                  setPage(1);
                  setKeyword(keywordInput.trim());
                }}
              >
                {t('搜索')}
              </Button>
            </Space>
            <Button
              type='primary'
              icon={<Plus size={16} />}
              onClick={openCreate}
            >
              {t('创建邀请码')}
            </Button>
          </div>
          <Table
            columns={columns}
            dataSource={codes}
            rowKey='id'
            pagination={false}
            empty={t('暂无邀请码')}
            scroll={{ x: 900 }}
          />
          <div className='flex justify-end mt-4'>
            <Pagination
              currentPage={page}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={setPage}
            />
          </div>
        </Card>
      </div>

      <Modal
        title={editingCode ? t('编辑邀请码') : t('创建邀请码')}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={submitCode}
        confirmLoading={submitting}
        centered
      >
        {editingCode && (
          <Banner type='info' description={editingCode.code} className='mb-4' />
        )}
        <div className='flex flex-col gap-4'>
          <div>
            <Text>{t('名称')}</Text>
            <Input
              value={formValues.name}
              onChange={(value) =>
                setFormValues((current) => ({ ...current, name: value }))
              }
              placeholder={t('可选备注')}
            />
          </div>
          {!editingCode && (
            <>
              <div>
                <Text>{t('自定义邀请码')}</Text>
                <Input
                  value={formValues.code}
                  onChange={(value) =>
                    setFormValues((current) => ({ ...current, code: value }))
                  }
                  placeholder={t('留空则随机生成')}
                />
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <Text>{t('随机码前缀')}</Text>
                  <Input
                    value={formValues.prefix}
                    onChange={(value) =>
                      setFormValues((current) => ({
                        ...current,
                        prefix: value,
                      }))
                    }
                    placeholder='VIP'
                  />
                </div>
                <div>
                  <Text>{t('生成数量')}</Text>
                  <InputNumber
                    value={formValues.count}
                    min={1}
                    max={100}
                    onChange={(value) =>
                      setFormValues((current) => ({
                        ...current,
                        count: Number(value || 1),
                      }))
                    }
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            </>
          )}
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <Text>{t('最大使用次数')}</Text>
              <InputNumber
                value={formValues.max_uses}
                min={0}
                max={1000000}
                onChange={(value) =>
                  setFormValues((current) => ({
                    ...current,
                    max_uses: Number(value || 0),
                  }))
                }
                style={{ width: '100%' }}
              />
              <Text type='tertiary' size='small'>
                {t('0 表示无限制')}
              </Text>
            </div>
            <div>
              <Text>{t('过期时间')}</Text>
              <DatePicker
                type='dateTime'
                value={formValues.expires_at}
                onChange={(value) =>
                  setFormValues((current) => ({
                    ...current,
                    expires_at: value || null,
                  }))
                }
                style={{ width: '100%' }}
                showClear
              />
            </div>
          </div>
        </div>
      </Modal>
    </Spin>
  );
};

export default InvitationSetting;
