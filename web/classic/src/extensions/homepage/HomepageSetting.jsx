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
import React, { useContext, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Input,
  Select,
  Spin,
  Switch,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatusContext } from '../../context/Status';
import { API, showError, showSuccess, setStatusData } from '../../helpers';

const { Text, Title } = Typography;

const defaultSettings = {
  enabled: false,
  mode: 'showcase',
  title: '',
  description: '',
  button_text: '',
  button_url: '',
};

const HomepageSetting = () => {
  const { t } = useTranslation();
  const [statusState, statusDispatch] = useContext(StatusContext);
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      try {
        const response = await API.get(
          '/api/extensions/homepage/admin/settings',
        );
        const { success, message, data } = response.data;
        if (!success) {
          throw new Error(message);
        }
        setSettings({ ...defaultSettings, ...data });
      } catch (error) {
        showError(error.message || t('加载首页设置失败'));
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, [t]);

  const updateField = (field, value) => {
    setSettings((current) => ({ ...current, [field]: value }));
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await API.put(
        '/api/extensions/homepage/admin/settings',
        settings,
      );
      const { success, message, data } = response.data;
      if (!success) {
        showError(message);
        return;
      }
      setSettings(data);
      const nextStatus = {
        ...(statusState?.status || {}),
        homepage_access: data,
      };
      statusDispatch({ type: 'set', payload: nextStatus });
      setStatusData(nextStatus);
      showSuccess(t('首页设置已保存'));
    } catch (error) {
      showError(error.message || t('保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Spin spinning={loading} size='large'>
      <Card>
        <div className='flex flex-col gap-6'>
          <div className='flex flex-wrap items-center justify-between gap-4 border-b border-semi-color-border pb-5'>
            <div>
              <Title heading={5}>{t('关闭公开首页')}</Title>
              <Text type='tertiary'>
                {t('替换整个根页面，不显示导航、站点标识或公开入口')}
              </Text>
            </div>
            <Switch
              checked={settings.enabled}
              onChange={(value) => updateField('enabled', value)}
            />
          </div>

          <div className='grid grid-cols-1 gap-5 md:grid-cols-2'>
            <div className='flex flex-col gap-2'>
              <Text>{t('替换页面')}</Text>
              <Select
                value={settings.mode}
                onChange={(value) => updateField('mode', value)}
                style={{ width: '100%' }}
              >
                <Select.Option value='community'>
                  {t('社区首页（仅新版前端）')}
                </Select.Option>
                <Select.Option value='showcase'>
                  {t('沉浸式场景')}
                </Select.Option>
                <Select.Option value='not_found'>
                  {t('404 风格页')}
                </Select.Option>
              </Select>
            </div>
            <div className='flex flex-col gap-2'>
              <Text>{t('页面标题')}</Text>
              <Input
                value={settings.title}
                maxLength={120}
                onChange={(value) => updateField('title', value)}
                placeholder={t('留空则使用默认标题')}
              />
            </div>
          </div>

          <div className='flex flex-col gap-2'>
            <Text>{t('页面说明')}</Text>
            <TextArea
              value={settings.description}
              maxCount={500}
              autosize={{ minRows: 3, maxRows: 6 }}
              onChange={(value) => updateField('description', value)}
              placeholder={t('留空则使用默认说明')}
            />
          </div>

          <div className='grid grid-cols-1 gap-5 md:grid-cols-2'>
            <div className='flex flex-col gap-2'>
              <Text>{t('按钮文字')}</Text>
              <Input
                value={settings.button_text}
                maxLength={50}
                onChange={(value) => updateField('button_text', value)}
                placeholder={t('可选按钮')}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Text>{t('按钮链接')}</Text>
              <Input
                value={settings.button_url}
                maxLength={2048}
                onChange={(value) => updateField('button_url', value)}
                placeholder='https://example.com'
              />
              <Text type='tertiary' size='small'>
                {t('按钮文字和链接都留空时不显示任何入口')}
              </Text>
            </div>
          </div>

          <div>
            <Button
              theme='solid'
              type='primary'
              icon={<Save size={16} />}
              loading={saving}
              onClick={saveSettings}
            >
              {t('保存')}
            </Button>
          </div>
        </div>
      </Card>
    </Spin>
  );
};

export default HomepageSetting;
