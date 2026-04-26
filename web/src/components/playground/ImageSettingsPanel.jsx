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
import {
  Card,
  Select,
  Typography,
  Button,
  InputNumber,
} from '@douyinfe/semi-ui';
import {
  Sparkles,
  Users,
  X,
  Settings,
  Image as ImageIcon,
  Hash,
  Maximize2,
  FileImage,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderGroupOption, selectFilter } from '../../helpers';
import {
  IMAGE_SIZE_OPTIONS,
  IMAGE_RESPONSE_FORMAT_OPTIONS,
  PLAYGROUND_MODES,
} from '../../constants/playground.constants';

const ImageSettingsPanel = ({
  mode,
  imageInputs,
  models,
  groups,
  styleState,
  onImageInputChange,
  onCloseSettings,
}) => {
  const { t } = useTranslation();

  const isEdit = mode === PLAYGROUND_MODES.IMAGE_EDIT;

  return (
    <Card
      className='h-full flex flex-col'
      bordered={false}
      bodyStyle={{
        padding: styleState.isMobile ? '16px' : '24px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className='flex items-center justify-between mb-6 flex-shrink-0'>
        <div className='flex items-center'>
          <div className='w-10 h-10 rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 flex items-center justify-center mr-3'>
            <Settings size={20} className='text-white' />
          </div>
          <Typography.Title heading={5} className='mb-0'>
            {isEdit ? t('图片编辑配置') : t('图片生成配置')}
          </Typography.Title>
        </div>

        {styleState.isMobile && onCloseSettings && (
          <Button
            icon={<X size={16} />}
            onClick={onCloseSettings}
            theme='borderless'
            type='tertiary'
            size='small'
            className='!rounded-lg'
          />
        )}
      </div>

      <div className='space-y-6 overflow-y-auto flex-1 pr-2 model-settings-scroll'>
        {/* 分组选择 */}
        <div>
          <div className='flex items-center gap-2 mb-2'>
            <Users size={16} className='text-gray-500' />
            <Typography.Text strong className='text-sm'>
              {t('分组')}
            </Typography.Text>
          </div>
          <Select
            placeholder={t('请选择分组')}
            name='image-group'
            selection
            filter={selectFilter}
            autoClearSearchValue={false}
            onChange={(value) => onImageInputChange('group', value)}
            value={imageInputs.group}
            optionList={groups}
            renderOptionItem={renderGroupOption}
            style={{ width: '100%' }}
            className='!rounded-lg'
          />
        </div>

        {/* 模型选择 */}
        <div>
          <div className='flex items-center gap-2 mb-2'>
            <Sparkles size={16} className='text-gray-500' />
            <Typography.Text strong className='text-sm'>
              {t('图像模型')}
            </Typography.Text>
          </div>
          <Select
            placeholder={t('请选择模型')}
            name='image-model'
            selection
            filter={selectFilter}
            autoClearSearchValue={false}
            onChange={(value) => onImageInputChange('model', value)}
            value={imageInputs.model}
            optionList={models}
            style={{ width: '100%' }}
            className='!rounded-lg'
          />
          <Typography.Text type='tertiary' size='small' className='block mt-1'>
            {t('推荐：gpt-image-2')}
          </Typography.Text>
        </div>

        {/* 尺寸 */}
        <div>
          <div className='flex items-center gap-2 mb-2'>
            <Maximize2 size={16} className='text-gray-500' />
            <Typography.Text strong className='text-sm'>
              {t('尺寸')}
            </Typography.Text>
          </div>
          <Select
            value={imageInputs.size}
            onChange={(value) => onImageInputChange('size', value)}
            optionList={IMAGE_SIZE_OPTIONS}
            style={{ width: '100%' }}
            className='!rounded-lg'
          />
        </div>

        {/* 数量 */}
        <div>
          <div className='flex items-center gap-2 mb-2'>
            <Hash size={16} className='text-gray-500' />
            <Typography.Text strong className='text-sm'>
              {t('数量')}
            </Typography.Text>
          </div>
          <InputNumber
            min={1}
            max={4}
            value={imageInputs.n}
            onChange={(value) => onImageInputChange('n', value || 1)}
            style={{ width: '100%' }}
            className='!rounded-lg'
          />
          <Typography.Text type='tertiary' size='small' className='block mt-1'>
            {t('单次最多生成 4 张')}
          </Typography.Text>
        </div>

        {/* 输出格式 */}
        <div>
          <div className='flex items-center gap-2 mb-2'>
            <FileImage size={16} className='text-gray-500' />
            <Typography.Text strong className='text-sm'>
              {t('输出格式')}
            </Typography.Text>
          </div>
          <Select
            value={imageInputs.response_format}
            onChange={(value) => onImageInputChange('response_format', value)}
            optionList={IMAGE_RESPONSE_FORMAT_OPTIONS}
            style={{ width: '100%' }}
            className='!rounded-lg'
          />
        </div>

        <div className='rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-xs text-blue-700 dark:text-blue-200 flex items-start gap-2'>
          <ImageIcon size={14} className='mt-0.5 flex-shrink-0' />
          <span>
            {isEdit
              ? t(
                  '上传 1-4 张源图，并在主区写一段编辑提示词，例如「把背景换成樱花」',
                )
              : t('在主区写下你的提示词，模型会按所选尺寸生成图像')}
          </span>
        </div>
      </div>
    </Card>
  );
};

export default ImageSettingsPanel;
