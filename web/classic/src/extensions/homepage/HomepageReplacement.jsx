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
import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { ArrowRight, Braces, Cpu, Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const HomepageReplacement = ({ settings, systemName, logo }) => {
  const { t } = useTranslation();
  const destination = settings.button_url || '/console';
  const buttonText = settings.button_text || t('打开控制台');

  const openDestination = () => {
    if (/^https?:\/\//i.test(destination)) {
      window.open(destination, '_blank', 'noopener,noreferrer');
      return;
    }
    window.location.assign(destination);
  };

  if (settings.mode === 'not_found') {
    return (
      <main className='classic-page-fill flex min-h-screen items-center justify-center px-6 pt-20'>
        <div className='max-w-xl text-center'>
          <div className='mb-5 font-mono text-sm text-semi-color-text-2'>
            HTTP / 404
          </div>
          <div className='text-8xl font-bold leading-none text-semi-color-text-0'>
            404
          </div>
          <h1 className='mt-6 text-2xl font-semibold text-semi-color-text-0'>
            {settings.title || t('此页面暂不可用')}
          </h1>
          <p className='mx-auto mt-3 max-w-md text-base leading-7 text-semi-color-text-2'>
            {settings.description || t('管理员已关闭公开首页。')}
          </p>
          <Button
            className='mt-8 !rounded-md'
            theme='solid'
            type='primary'
            icon={<ArrowRight size={16} />}
            onClick={openDestination}
          >
            {buttonText}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className='classic-page-fill relative flex min-h-screen items-center overflow-hidden bg-semi-color-bg-0 px-6 pt-20'>
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0 opacity-60'
      >
        <div className='absolute inset-y-0 left-[12%] border-l border-semi-color-border' />
        <div className='absolute inset-y-0 left-[36%] border-l border-semi-color-border' />
        <div className='absolute inset-y-0 right-[36%] border-l border-semi-color-border' />
        <div className='absolute inset-y-0 right-[12%] border-l border-semi-color-border' />
        <div className='absolute inset-x-0 top-[28%] border-t border-semi-color-border' />
        <div className='absolute inset-x-0 bottom-[24%] border-t border-semi-color-border' />
        <div className='absolute left-[12%] top-[28%] size-2 -translate-x-1 -translate-y-1 bg-emerald-500' />
        <div className='absolute bottom-[24%] right-[12%] size-2 translate-x-1 translate-y-1 bg-cyan-500' />
        <div className='absolute right-[36%] top-[28%] h-px w-24 bg-red-500' />
      </div>

      <div className='relative mx-auto w-full max-w-5xl py-24 text-center'>
        <div className='mx-auto mb-7 flex size-16 items-center justify-center border border-semi-color-border'>
          {logo ? (
            <img src={logo} alt='' className='size-11 object-contain' />
          ) : (
            <Network className='size-8' aria-hidden='true' />
          )}
        </div>
        <div className='mb-5 flex items-center justify-center gap-3 font-mono text-xs uppercase text-semi-color-text-2'>
          <span className='size-1.5 bg-emerald-500' aria-hidden='true' />
          {t('网关在线')}
        </div>
        <h1 className='text-4xl font-bold text-semi-color-text-0 sm:text-5xl md:text-6xl'>
          {systemName || 'New API'}
        </h1>
        <p className='mx-auto mt-6 max-w-3xl text-xl font-medium text-semi-color-text-0 sm:text-2xl'>
          {settings.title || t('一个网关，连接所有模型。')}
        </p>
        <p className='mx-auto mt-4 max-w-2xl text-base leading-7 text-semi-color-text-2'>
          {settings.description || t('专注、快速、可靠的 AI 服务统一入口。')}
        </p>
        <Button
          className='mt-9 !rounded-md'
          theme='solid'
          type='primary'
          icon={<ArrowRight size={16} />}
          onClick={openDestination}
        >
          {buttonText}
        </Button>

        <div className='mx-auto mt-16 flex max-w-md items-center justify-between border-t border-semi-color-border pt-5 text-semi-color-text-2'>
          <span className='flex items-center gap-2 text-xs'>
            <Braces size={16} aria-hidden='true' /> API
          </span>
          <span className='flex items-center gap-2 text-xs'>
            <Cpu size={16} aria-hidden='true' /> AI
          </span>
          <span className='flex items-center gap-2 text-xs'>
            <Network size={16} aria-hidden='true' /> Gateway
          </span>
        </div>
      </div>
    </main>
  );
};

export default HomepageReplacement;
