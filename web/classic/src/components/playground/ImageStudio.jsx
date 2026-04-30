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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  Toast,
} from '@douyinfe/semi-ui';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock3,
  History,
  LoaderCircle,
  MessageSquarePlus,
  PencilLine,
  Plus,
  SendHorizontal,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  IMAGE_EDIT_MAX_FILES,
  IMAGE_SIZE_OPTIONS,
  PLAYGROUND_MODES,
} from '../../constants/playground.constants';

const cn = (...classes) => classes.filter(Boolean).join(' ');

const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString();
};

const getImageSrc = (item) =>
  item?.b64_json
    ? `data:image/png;base64,${item.b64_json}`
    : item?.objectUrl || item?.url || '';

const getTurnStatusLabel = (status, t) => {
  if (status === 'queued') return t('排队中');
  if (status === 'generating') return t('处理中');
  if (status === 'success') return t('已完成');
  return t('失败');
};

const normalizeSizeForUi = (size) => {
  if (!size || size === 'auto') return 'auto';
  if (size === '1024x1024') return '1:1';
  if (size === '1536x1024') return '3:2';
  if (size === '1024x1536') return '2:3';
  return size || '';
};

const denormalizeSizeFromUi = (size) => {
  if (size === '1:1') return '1024x1024';
  if (size === '3:2') return '1536x1024';
  if (size === '2:3') return '1024x1536';
  return size || 'auto';
};

const createDraftConversationId = () => {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
};

const createFallbackConversation = (t, id = 'draft') => ({
  id,
  title: t('新的图片对话'),
  updatedAt: new Date().toISOString(),
  turns: [],
});

const buildConversations = (imageHistory, t) => {
  if (!Array.isArray(imageHistory) || imageHistory.length === 0) return [];

  const conversationMap = new Map();

  imageHistory.forEach((batch, index) => {
    const isGeneratingBatch =
      batch?.status === 'loading' ||
      batch?.status === 'generating' ||
      batch?.status === 'queued';
    const hasItems = Array.isArray(batch?.items) && batch.items.length > 0;
    const status =
      isGeneratingBatch
        ? 'generating'
        : batch?.status === 'error'
          ? 'error'
          : !hasItems
            ? 'error'
          : 'success';
    const prompt = batch?.prompt || t('无提示词');
    const mode =
      batch?.mode === PLAYGROUND_MODES.IMAGE_EDIT ? 'edit' : 'generate';
    const conversationId = batch?.conversationId || batch?.id || `batch-${index}`;
    const createdAt = batch?.createdAt || Date.now();
    const turn = {
      id: batch?.id || `turn-${index}`,
      prompt,
      mode,
      status,
      count: batch?.n || Math.max(1, batch?.items?.length || 1),
      size: normalizeSizeForUi(batch?.size),
      createdAt,
      error: batch?.error,
      referenceImages: (batch?.sources || []).map((source, sourceIndex) => ({
        id: `${batch?.id || index}-source-${sourceIndex}`,
        name: source?.name || `image-${sourceIndex + 1}`,
        dataUrl: source?.dataUrl || source?.url || '',
      })),
      images:
        hasItems
          ? batch.items.map((item, itemIndex) => ({
              id: `${batch?.id || index}-${itemIndex}`,
              status:
                status === 'error'
                  ? 'error'
                  : item?.partial && isGeneratingBatch
                    ? 'loading'
                    : getImageSrc(item)
                      ? 'success'
                      : 'error',
              src: getImageSrc(item),
              error: batch?.error || t('图片缓存已失效，请重新生成'),
              item,
            }))
          : Array.from({
              length: Math.max(1, Math.min(batch?.n || 1, 4)),
            }).map((_, itemIndex) => ({
              id: `${batch?.id || index}-${itemIndex}`,
              status: isGeneratingBatch ? 'loading' : 'error',
              error: batch?.error || t('图片缓存已失效，请重新生成'),
            })),
    };

    const existing = conversationMap.get(conversationId);
    if (existing) {
      existing.turns.push(turn);
      existing.updatedAt = Math.max(existing.updatedAt, createdAt);
      if (createdAt < existing.createdAt) {
        existing.createdAt = createdAt;
        existing.title = prompt.slice(0, 28) || t('图片对话');
      }
      return;
    }

    conversationMap.set(conversationId, {
      id: conversationId,
      title: prompt.slice(0, 28) || t('图片对话'),
      createdAt,
      updatedAt: createdAt,
      turns: [turn],
    });
  });

  return Array.from(conversationMap.values())
    .map((conversation) => ({
      ...conversation,
      turns: conversation.turns.sort(
        (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0),
      ),
    }))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
};

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const dataUrlToFile = async (dataUrl, filename) => {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error(`Failed to load image: ${response.status}`);
  }
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/png' });
};

const getImageFileName = (filename, mimeType) => {
  const extension =
    mimeType === 'image/jpeg'
      ? 'jpg'
      : mimeType === 'image/webp'
        ? 'webp'
        : 'png';
  return filename.includes('.') ? filename : `${filename}.${extension}`;
};

const imageResultToFile = async (image, filename = 'generated-image') => {
  const item = image?.item || {};
  const mimeType = item.mime_type || item.mime || item.type || 'image/png';

  if (item.b64_json) {
    return dataUrlToFile(
      `data:${mimeType};base64,${item.b64_json}`,
      getImageFileName(filename, mimeType),
    );
  }

  if (image?.src) {
    return dataUrlToFile(image.src, getImageFileName(filename, mimeType));
  }

  throw new Error('No image source');
};

const ImageSidebar = ({
  conversations,
  selectedConversationId,
  onClearHistory,
  onSelectConversation,
  onDeleteConversation,
  t,
}) => (
  <aside className='min-h-0'>
    <div className='flex h-full min-h-0 flex-col gap-2 py-1 sm:gap-3 sm:py-2'>
      <div className='flex items-center justify-end'>
        <button
          type='button'
          className='inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-[rgba(28,31,35,0.06)] bg-white px-3 text-sm text-stone-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-[rgba(255,255,255,0.08)] dark:bg-zinc-950 dark:text-stone-300'
          onClick={() => {
            Modal.confirm({
              title: t('确认清空'),
              content: t('确定要清空所有图片会话记录吗？此操作不可撤销。'),
              okText: t('清空'),
              cancelText: t('取消'),
              okButtonProps: {
                type: 'danger',
              },
              onOk: onClearHistory,
            });
          }}
          disabled={conversations.length === 0}
          aria-label={t('清空历史')}
        >
          {t('清空')}
        </button>
      </div>

      <div className='min-h-0 flex-1 space-y-2 overflow-y-auto pr-1'>
        {conversations.length === 0 ? (
          <div className='px-1 py-3 text-sm leading-6 text-stone-500'>
            {t('还没有图片记录，输入提示词后会在这里显示。')}
          </div>
        ) : (
          conversations.map((conversation) => {
            const active = conversation.id === selectedConversationId;
            const turn = conversation.turns[0];
            const running = turn?.status === 'generating' ? 1 : 0;
            const queued = turn?.status === 'queued' ? 1 : 0;

            return (
              <div
                key={conversation.id}
                className={cn(
                  'group relative w-full border-l-2 px-2 py-2 text-left transition sm:py-3',
                  active
                    ? 'border-stone-900 bg-black/[0.03] text-stone-950 dark:border-stone-100 dark:bg-white/[0.06] dark:text-stone-50'
                    : 'border-transparent text-stone-700 hover:border-stone-300 hover:bg-white/40 dark:text-stone-300 dark:hover:bg-white/[0.04]',
                )}
              >
                <button
                  type='button'
                  onClick={() => onSelectConversation(conversation.id)}
                  className='block w-full cursor-pointer pr-8 text-left'
                >
                  <div className='truncate text-sm font-semibold'>
                    {conversation.title}
                  </div>
                  <div
                    className={cn(
                      'mt-1 text-xs',
                      active ? 'text-stone-500' : 'text-stone-400',
                    )}
                  >
                    {conversation.turns.length} {t('轮')} ·{' '}
                    {formatTime(conversation.updatedAt)}
                  </div>
                  {running > 0 || queued > 0 ? (
                    <div className='mt-2 flex flex-wrap items-center gap-2 text-[11px]'>
                      {running > 0 ? (
                        <span className='rounded-full bg-blue-50 px-2 py-1 text-blue-600'>
                          {t('处理中')} {running}
                        </span>
                      ) : null}
                      {queued > 0 ? (
                        <span className='rounded-full bg-amber-50 px-2 py-1 text-amber-700'>
                          {t('排队')} {queued}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
                <button
                  type='button'
                  onClick={() => onDeleteConversation(conversation.id)}
                  className='absolute right-2 top-3 inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-stone-400 opacity-0 transition hover:bg-stone-100 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-zinc-800'
                  aria-label={t('删除会话')}
                >
                  <Trash2 className='size-4' />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  </aside>
);

const ImageResults = ({
  selectedConversation,
  onOpenLightbox,
  onContinueEdit,
  onResendPrompt,
  t,
}) => {
  const [editingTurnId, setEditingTurnId] = useState(null);
  const [editingPrompt, setEditingPrompt] = useState('');

  if (!selectedConversation || selectedConversation.turns.length === 0) {
    return (
      <div className='flex h-full min-h-[420px] items-center justify-center text-center'>
        <div className='w-full max-w-4xl'>
          <h1
            className='text-3xl font-semibold tracking-tight text-stone-950 dark:text-stone-100 md:text-5xl'
            style={{
              fontFamily:
                '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            Turn ideas into images
          </h1>
          <p
            className='mt-4 text-[15px] italic tracking-[0.01em] text-stone-500'
            style={{
              fontFamily:
                '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            {t(
              '在同一窗口里保留本地历史与任务状态，并从已有结果图继续发起新的无状态编辑。',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='mx-auto flex w-full max-w-[980px] flex-col gap-8'>
      {selectedConversation.turns.map((turn, turnIndex) => {
        const successfulImages = turn.images
          .filter((image) => image.status === 'success' && image.src)
          .map((image) => ({ id: image.id, src: image.src, item: image.item }));

        return (
          <div key={turn.id} className='flex flex-col gap-4'>
            <div className='flex justify-end'>
              <div className='max-w-[82%] px-1 py-1 text-[15px] leading-7 text-stone-900 dark:text-stone-100'>
                <div className='mb-2 flex flex-wrap justify-end gap-2 text-[11px] text-stone-400'>
                  <span>{t('第 {{index}} 轮', { index: turnIndex + 1 })}</span>
                  <span>
                    {turn.mode === 'edit' ? t('编辑图') : t('文生图')}
                  </span>
                  <span>{getTurnStatusLabel(turn.status, t)}</span>
                  <span>{formatTime(turn.createdAt)}</span>
                </div>
                {editingTurnId === turn.id ? (
                  <div className='ml-auto max-w-xl'>
                    <textarea
                      value={editingPrompt}
                      onChange={(event) => setEditingPrompt(event.target.value)}
                      className='min-h-[86px] w-full resize-none rounded-2xl border border-[rgba(28,31,35,0.08)] bg-[rgba(255,255,255,0.68)] px-4 py-3 text-left text-[15px] leading-7 text-stone-900 outline-none transition focus:border-[rgba(28,31,35,0.16)] dark:border-[rgba(255,255,255,0.08)] dark:bg-[rgba(24,25,27,0.72)] dark:text-stone-100'
                    />
                    <div className='mt-2 flex justify-end gap-2'>
                      <button
                        type='button'
                        className='inline-flex h-8 cursor-pointer items-center justify-center rounded-full border border-[rgba(28,31,35,0.06)] bg-transparent px-3 text-xs text-stone-500 transition hover:bg-black/[0.03] dark:border-[rgba(255,255,255,0.08)] dark:hover:bg-white/[0.04]'
                        onClick={() => {
                          setEditingTurnId(null);
                          setEditingPrompt('');
                        }}
                      >
                        {t('取消')}
                      </button>
                      <button
                        type='button'
                        className='inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-[rgba(28,31,35,0.08)] bg-[#ffffff] px-3 text-xs font-medium text-[#1c1f23] shadow-[0_6px_18px_-14px_rgba(28,31,35,0.5)] transition hover:bg-[#f8f8f8] disabled:cursor-not-allowed disabled:text-[rgba(28,31,35,0.34)] dark:border-[rgba(255,255,255,0.08)] dark:bg-zinc-950 dark:text-stone-100'
                        disabled={!editingPrompt.trim()}
                        onClick={() => {
                          const nextPrompt = editingPrompt.trim();
                          if (!nextPrompt) return;
                          onResendPrompt?.(turn, nextPrompt);
                          setEditingTurnId(null);
                          setEditingPrompt('');
                        }}
                      >
                        <SendHorizontal className='size-3.5' />
                        {t('重新发送')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className='group/prompt flex items-start justify-end gap-2 text-right'>
                    <button
                      type='button'
                      className='mt-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[rgba(28,31,35,0.06)] bg-transparent text-stone-400 opacity-0 transition hover:bg-black/[0.03] hover:text-stone-700 group-hover/prompt:opacity-100 dark:border-[rgba(255,255,255,0.08)] dark:hover:bg-white/[0.04] dark:hover:text-stone-100'
                      onClick={() => {
                        setEditingTurnId(turn.id);
                        setEditingPrompt(turn.prompt || '');
                      }}
                      aria-label={t('编辑提示词')}
                    >
                      <PencilLine className='size-3.5' />
                    </button>
                    <div>{turn.prompt}</div>
                  </div>
                )}
              </div>
            </div>

            <div className='flex justify-start'>
              <div className='w-full p-1'>
                <div className='mb-4 flex flex-wrap items-center gap-2 text-xs text-stone-500'>
                  <span className='rounded-full bg-stone-100 px-3 py-1 dark:bg-zinc-900'>
                    {turn.count} {t('张')}
                  </span>
                  <span className='rounded-full bg-stone-100 px-3 py-1 dark:bg-zinc-900'>
                    {getTurnStatusLabel(turn.status, t)}
                  </span>
                </div>

                <div className='columns-1 gap-4 space-y-4 sm:columns-2 xl:columns-3'>
                  {turn.images.map((image, index) => {
                    if (image.status === 'success' && image.src) {
                      const currentIndex = successfulImages.findIndex(
                        (item) => item.id === image.id,
                      );

                      return (
                        <div
                          key={image.id}
                          className='break-inside-avoid overflow-hidden'
                        >
                          <button
                            type='button'
                            onClick={() =>
                              onOpenLightbox(successfulImages, currentIndex)
                            }
                            className='group block w-full cursor-zoom-in'
                          >
                            <img
                              src={image.src}
                              alt={`Generated result ${index + 1}`}
                              className='block h-auto w-full transition duration-200 group-hover:brightness-90'
                            />
                          </button>
                          <div className='flex items-center justify-between gap-2 px-3 py-3'>
                            <div className='text-xs text-stone-500'>
                              {t('结果')} {index + 1}
                            </div>
                            <button
                              type='button'
                              className='inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 text-sm text-stone-700 transition hover:bg-stone-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-stone-200'
                              onClick={() => onContinueEdit(image)}
                            >
                              <Sparkles className='size-4' />
                              {t('加入编辑')}
                            </button>
                          </div>
                        </div>
                      );
                    }

                    if (image.status === 'error') {
                      return (
                        <div
                          key={image.id}
                          className='break-inside-avoid aspect-square overflow-hidden border border-rose-200 bg-rose-50'
                        >
                          <div className='flex h-full items-center justify-center px-6 py-8 text-center text-sm leading-6 text-rose-600'>
                            {image.error || t('生成失败')}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={image.id}
                        className='break-inside-avoid'
                      >
                        <div className='image-loading-card aspect-square overflow-hidden rounded-[28px] border border-[rgba(28,31,35,0.06)] dark:border-[rgba(255,255,255,0.08)]'>
                          <div className='image-loading-grid' />
                          <div className='relative z-10 flex h-full flex-col items-center justify-center gap-4 px-6 py-8 text-center'>
                            <div className='image-loading-icon inline-flex size-14 items-center justify-center rounded-full border border-[rgba(28,31,35,0.06)] bg-[rgba(255,255,255,0.72)] text-[#30343a] shadow-[0_14px_34px_-26px_rgba(28,31,35,0.5)] dark:border-[rgba(255,255,255,0.08)] dark:bg-[rgba(24,25,27,0.72)] dark:text-[#f4f4f5]'>
                              {turn.status === 'queued' ? (
                                <Clock3 className='size-5' />
                              ) : (
                                <LoaderCircle className='size-5 animate-spin' />
                              )}
                            </div>
                            <div className='space-y-1.5'>
                              <p className='text-sm font-medium text-[#30343a] dark:text-[#f4f4f5]'>
                                {turn.status === 'queued'
                                  ? t('等待生成')
                                  : t('正在生成第 {{index}} 张', {
                                      index: index + 1,
                                    })}
                              </p>
                              <p className='text-xs text-[rgba(48,52,58,0.52)] dark:text-[rgba(244,244,245,0.48)]'>
                                {turn.status === 'queued'
                                  ? t('任务已进入队列')
                                  : t('图像细节正在生成中')}
                              </p>
                            </div>
                            <div className='image-loading-bar h-1 w-24 overflow-hidden rounded-full bg-[rgba(28,31,35,0.06)] dark:bg-[rgba(255,255,255,0.08)]'>
                              <span className='block h-full w-1/2 rounded-full bg-[rgba(28,31,35,0.34)] dark:bg-[rgba(255,255,255,0.42)]' />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {turn.status === 'error' && turn.error ? (
                  <div className='mt-4 border-l-2 border-amber-300 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-700'>
                    {turn.error}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const ImageComposer = ({
  mode,
  prompt,
  model,
  models,
  imageCount,
  imageSize,
  activeTaskCount,
  referenceImages,
  textareaRef,
  fileInputRef,
  onPromptChange,
  onModelChange,
  onImageCountChange,
  onImageSizeChange,
  onSubmit,
  onPickReferenceImage,
  onReferenceImageChange,
  onRemoveReferenceImage,
  t,
}) => {
  const [referenceLightboxOpen, setReferenceLightboxOpen] = useState(false);
  const [referenceLightboxIndex, setReferenceLightboxIndex] = useState(0);
  const [isReferenceStackExpanded, setIsReferenceStackExpanded] =
    useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isSizeMenuOpen, setIsSizeMenuOpen] = useState(false);
  const composerRef = useRef(null);
  const modelMenuRef = useRef(null);
  const sizeMenuRef = useRef(null);
  const lightboxImages = useMemo(
    () =>
      referenceImages.map((image, index) => ({
        id: `${image.name}-${index}`,
        src: image.dataUrl,
      })),
    [referenceImages],
  );
  const imageSizeOptions = [
    { value: 'auto', label: t('未指定') },
    { value: '1:1', label: '1:1 (正方形)' },
    { value: '3:2', label: '3:2 (横版)' },
    { value: '2:3', label: '2:3 (竖版)' },
  ];
  const imageSizeLabel =
    imageSizeOptions.find((option) => option.value === imageSize)?.label ||
    t('未指定');
  const modelOptions = useMemo(() => {
    const normalized = Array.isArray(models) ? models : [];
    const options = normalized
      .map((item) => ({
        value: item?.value || item?.id || item?.name || '',
        label: item?.label || item?.text || item?.value || item?.name || '',
      }))
      .filter((item) => item.value);
    if (options.length > 0) return options;
    return [{ value: 'gpt-image-2', label: 'gpt-image-2' }];
  }, [models]);
  const selectedModel = model || 'gpt-image-2';
  const selectedModelLabel =
    modelOptions.find((option) => option.value === selectedModel)?.label ||
    selectedModel;
  const canExpandReferenceStack = referenceImages.length > 1;
  const referenceStackExpanded =
    canExpandReferenceStack && isReferenceStackExpanded;
  const referenceStackWidth =
    referenceImages.length > 0 && referenceStackExpanded
      ? 62 +
        (referenceImages.length - 1) * 54 +
        (referenceImages.length < IMAGE_EDIT_MAX_FILES ? 52 : 0)
      : 62;
  const isComposerExpanded =
    isComposerFocused || isModelMenuOpen || isSizeMenuOpen;

  useEffect(() => {
    if (!isSizeMenuOpen && !isModelMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!modelMenuRef.current?.contains(event.target)) {
        setIsModelMenuOpen(false);
      }
      if (!sizeMenuRef.current?.contains(event.target)) {
        setIsSizeMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isModelMenuOpen, isSizeMenuOpen]);

  const handleTextareaPaste = (event) => {
    const imageFiles = Array.from(event.clipboardData?.files || []).filter(
      (file) => file.type.startsWith('image/'),
    );
    if (imageFiles.length === 0) return;
    event.preventDefault();
    void onReferenceImageChange(imageFiles);
  };

  return (
    <div className='flex shrink-0 justify-center px-2 pb-1'>
      <div style={{ width: 'min(980px, 100%)' }}>
        <input
          ref={fileInputRef}
          type='file'
          accept='image/*'
          multiple
          className='hidden'
          onChange={(event) => {
            void onReferenceImageChange(Array.from(event.target.files || []));
            event.target.value = '';
          }}
        />

        <Lightbox
          images={lightboxImages}
          currentIndex={referenceLightboxIndex}
          open={referenceLightboxOpen}
          onOpenChange={setReferenceLightboxOpen}
          onIndexChange={setReferenceLightboxIndex}
        />

        <div
          className={cn(
            'image-composer-glass overflow-visible rounded-[32px] border border-[rgba(28,31,35,0.07)] shadow-none transition-[border-color,box-shadow] duration-200 ease-out dark:border-[rgba(255,255,255,0.08)]',
            isComposerExpanded && 'border-[rgba(28,31,35,0.1)]',
          )}
        >
          <div
            ref={composerRef}
            className='image-composer-inner relative cursor-text'
            onFocus={() => setIsComposerFocused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setIsComposerFocused(false);
              }
            }}
            onClick={() => {
              textareaRef.current?.focus();
            }}
          >
            <div
              className={cn(
                'flex gap-3 px-5 pt-3 transition-[padding] duration-200 ease-out sm:px-6',
                isComposerExpanded ? 'pb-0 sm:pt-4' : 'pb-3 sm:pt-3',
              )}
            >
              <div
                className={cn(
                  'relative mt-1 h-[68px] shrink-0',
                  canExpandReferenceStack &&
                    'transition-[width] duration-200 ease-out',
                )}
                style={{ width: referenceStackWidth }}
                onMouseEnter={() => {
                  if (canExpandReferenceStack) {
                    setIsReferenceStackExpanded(true);
                  }
                }}
                onMouseLeave={() => {
                  if (canExpandReferenceStack) {
                    setIsReferenceStackExpanded(false);
                  }
                }}
                onFocus={() => {
                  if (canExpandReferenceStack) {
                    setIsReferenceStackExpanded(true);
                  }
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setIsReferenceStackExpanded(false);
                  }
                }}
              >
                {referenceImages.length === 0 ? (
                  <button
                    type='button'
                    className='absolute left-1 top-0 inline-flex h-[60px] w-[46px] -rotate-[8deg] cursor-pointer items-center justify-center rounded-[3px] border border-[rgba(28,31,35,0.06)] bg-[#f1f2f2] text-[#9aa3aa] shadow-[0_10px_24px_-20px_rgba(28,31,35,0.5),0_1px_2px_rgba(28,31,35,0.06)] transition hover:bg-[#ebeeee] hover:text-[#6f7880]'
                    onClick={(event) => {
                      event.stopPropagation();
                      onPickReferenceImage();
                    }}
                    aria-label={t('添加参考图')}
                  >
                    <Plus className='size-5' />
                  </button>
                ) : (
                  <>
                    {referenceImages.map((image, index) => {
                      const topIndex = referenceImages.length - 1;
                      const cardLeft = referenceStackExpanded
                        ? index * 54
                        : index * 6;
                      const cardTop = referenceStackExpanded
                        ? Math.abs(index - 1) * 4
                        : index * 3;
                      const cardRotation = referenceStackExpanded
                        ? -7 + index * 5
                        : -8 + index * 4;
                      return (
                        <div
                          key={`${image.name}-${index}`}
                          className={cn(
                            'absolute h-[60px] w-[46px]',
                            canExpandReferenceStack &&
                              'transition-[left,top,transform] duration-200 ease-out',
                          )}
                          style={{
                            left: `${cardLeft}px`,
                            top: `${cardTop}px`,
                            zIndex: index + 1,
                            transform: `rotate(${cardRotation}deg)`,
                          }}
                        >
                          <button
                            type='button'
                            onClick={(event) => {
                              event.stopPropagation();
                              setReferenceLightboxIndex(index);
                              setReferenceLightboxOpen(true);
                            }}
                            className='h-full w-full cursor-zoom-in overflow-hidden rounded-[3px] border border-[rgba(28,31,35,0.08)] bg-[#f7f7f6] shadow-[0_10px_24px_-20px_rgba(28,31,35,0.5),0_1px_2px_rgba(28,31,35,0.06)] transition-[border-color] duration-200 ease-out hover:border-[rgba(28,31,35,0.16)]'
                            aria-label={`预览参考图 ${image.name || index + 1}`}
                          >
                            <img
                              src={image.dataUrl}
                              alt={image.name || `参考图 ${index + 1}`}
                              className='h-full w-full object-cover'
                            />
                            {!referenceStackExpanded &&
                            index === topIndex &&
                            referenceImages.length > 1 ? (
                              <span className='absolute bottom-1 right-1 rounded-full bg-[rgba(28,31,35,0.72)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#ffffff]'>
                                {referenceImages.length}
                              </span>
                            ) : null}
                          </button>
                          {(referenceStackExpanded || index === topIndex) ? (
                            <button
                              type='button'
                              onClick={(event) => {
                                event.stopPropagation();
                                onRemoveReferenceImage(index);
                              }}
                              className='absolute -right-2 -top-2 z-20 inline-flex size-5 cursor-pointer items-center justify-center rounded-full border border-[rgba(28,31,35,0.08)] bg-[#ffffff] text-[#55514b] shadow-[0_3px_10px_-6px_rgba(28,31,35,0.45)] transition hover:bg-[#f7f7f6] hover:text-[#1c1f23]'
                              aria-label={t('移除参考图')}
                            >
                              <X className='size-3' />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                    {referenceImages.length < IMAGE_EDIT_MAX_FILES ? (
                      <button
                        type='button'
                        className={cn(
                          'absolute z-20 inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-[rgba(28,31,35,0.08)] bg-[#ffffff] text-[#1c1f23] shadow-[0_5px_14px_-10px_rgba(28,31,35,0.5),0_1px_2px_rgba(28,31,35,0.08)] hover:bg-[#f8f8f8]',
                          canExpandReferenceStack &&
                            'transition-[left,top,transform,background-color] duration-200 ease-out',
                        )}
                        style={{
                          left: referenceStackExpanded
                            ? `${referenceImages.length * 54}px`
                            : '42px',
                          top: referenceStackExpanded ? '18px' : '41px',
                          transform: referenceStackExpanded
                            ? 'rotate(-8deg)'
                            : 'rotate(0deg)',
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onPickReferenceImage();
                        }}
                        aria-label={t('添加参考图')}
                      >
                        <Plus className='size-4' />
                      </button>
                    ) : null}
                  </>
                )}
              </div>
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                onPaste={handleTextareaPaste}
                placeholder={
                  referenceImages.length > 0
                    ? t('描述你希望如何修改这张参考图，可直接粘贴图片')
                    : t('输入你想要生成的画面，也可直接粘贴图片')
                }
                className={cn(
                  'min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent pl-1 pr-0 pt-1 text-[15px] leading-7 text-stone-900 shadow-none outline-none transition-[height,padding] duration-200 ease-out placeholder:text-stone-400 focus:ring-0 dark:text-stone-100',
                  isComposerExpanded
                    ? 'h-[140px] pb-[76px] sm:h-[134px] sm:pb-[76px]'
                    : 'h-[64px] pb-2 sm:h-[62px] sm:pb-2',
                )}
              />
            </div>

            <div
              className={cn(
                'absolute inset-x-0 bottom-0 bg-transparent px-4 pb-3 pt-6 transition-[opacity,transform] duration-200 ease-out sm:px-6',
                isComposerExpanded
                  ? 'pointer-events-auto translate-y-0 opacity-100'
                  : 'pointer-events-none translate-y-2 opacity-0',
              )}
            >
              <div className='flex items-end justify-between gap-2'>
                <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
                  <div
                    ref={modelMenuRef}
                    className='relative flex h-9 min-w-[136px] max-w-[210px] items-center gap-2 rounded-full border border-[#e7e4df] bg-white px-4 text-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-zinc-950'
                  >
                    <button
                      type='button'
                      className='flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 bg-transparent text-left text-sm font-semibold text-stone-700 dark:text-stone-100'
                      onClick={() => {
                        setIsSizeMenuOpen(false);
                        setIsModelMenuOpen((open) => !open);
                      }}
                    >
                      <span className='truncate'>{selectedModelLabel}</span>
                      <ChevronDown
                        className={cn(
                          'size-4 shrink-0 opacity-60 transition',
                          isModelMenuOpen && 'rotate-180',
                        )}
                      />
                    </button>
                    {isModelMenuOpen ? (
                      <div className='absolute bottom-[calc(100%+14px)] left-0 z-50 w-[260px] max-w-[calc(100vw-96px)] overflow-hidden rounded-3xl border border-[rgba(28,31,35,0.06)] bg-[#ffffff] p-2 shadow-[0_12px_32px_-24px_rgba(15,23,42,0.22)] dark:border-[rgba(255,255,255,0.08)] dark:bg-zinc-950'>
                        <div className='max-h-[240px] overflow-y-auto pr-1'>
                          {modelOptions.map((option) => {
                            const active = option.value === selectedModel;
                            return (
                              <button
                                key={option.value}
                                type='button'
                                className={cn(
                                  'flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-zinc-900',
                                  active &&
                                    'bg-stone-100 font-medium text-stone-950 dark:bg-zinc-900 dark:text-stone-50',
                                )}
                                onClick={() => {
                                  onModelChange(option.value);
                                  setIsModelMenuOpen(false);
                                }}
                              >
                                <span className='min-w-0 flex-1 truncate'>
                                  {option.label}
                                </span>
                                {active ? (
                                  <Check className='size-4 shrink-0' />
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {activeTaskCount > 0 && (
                    <div className='flex h-9 items-center gap-1.5 rounded-full bg-amber-50 px-3 text-sm font-semibold text-amber-700'>
                      <LoaderCircle className='size-3 animate-spin' />
                      {activeTaskCount}
                      <span className='hidden sm:inline'>
                        {' '}
                        {t('个任务处理中')}
                      </span>
                    </div>
                  )}
                  <div className='flex h-9 items-center gap-2 rounded-full border border-[#e7e4df] bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950'>
                    <span className='text-sm font-semibold text-stone-700 dark:text-stone-200'>
                      {t('张数')}
                    </span>
                    <input
                      type='number'
                      min='1'
                      max='10'
                      step='1'
                      value={imageCount}
                      onChange={(event) =>
                        onImageCountChange(event.target.value)
                      }
                      className='h-7 w-10 border-0 bg-transparent px-0 text-center text-sm font-semibold text-stone-700 shadow-none outline-none focus:ring-0 dark:text-stone-100'
                    />
                  </div>
                  <div
                    ref={sizeMenuRef}
                    className='relative flex h-9 items-center gap-2 rounded-full border border-[#e7e4df] bg-white px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950'
                  >
                    <span className='font-semibold text-stone-700 dark:text-stone-200'>
                      {t('比例')}
                    </span>
                    <button
                      type='button'
                      className='flex h-7 w-[112px] cursor-pointer items-center justify-between bg-transparent text-left text-sm font-semibold text-stone-700 dark:text-stone-100'
                      onClick={() => {
                        setIsModelMenuOpen(false);
                        setIsSizeMenuOpen((open) => !open);
                      }}
                    >
                      <span className='truncate'>{imageSizeLabel}</span>
                      <ChevronDown
                        className={cn(
                          'size-4 shrink-0 opacity-60 transition',
                          isSizeMenuOpen && 'rotate-180',
                        )}
                      />
                    </button>
                    {isSizeMenuOpen ? (
                      <div className='absolute bottom-[calc(100%+10px)] left-0 z-50 w-[186px] overflow-hidden rounded-3xl border border-[rgba(28,31,35,0.06)] bg-[#ffffff] p-2 shadow-[0_12px_32px_-24px_rgba(15,23,42,0.22)] dark:border-[rgba(255,255,255,0.08)] dark:bg-zinc-950'>
                        {imageSizeOptions.map((option) => {
                          const active = option.value === imageSize;
                          return (
                            <button
                              key={option.label}
                              type='button'
                              className={cn(
                                'flex w-full cursor-pointer items-center justify-between rounded-2xl px-3 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-zinc-900',
                                active &&
                                  'bg-stone-100 font-medium text-stone-950 dark:bg-zinc-900 dark:text-stone-50',
                              )}
                              onClick={() => {
                                onImageSizeChange(option.value);
                                setIsSizeMenuOpen(false);
                              }}
                            >
                              <span>{option.label}</span>
                              {active ? <Check className='size-4' /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                </div>

                <button
                  type='button'
                  onClick={() => void onSubmit()}
                  disabled={!prompt.trim()}
                  className='inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[rgba(28,31,35,0.08)] bg-[#ffffff] text-[#1c1f23] shadow-[0_8px_22px_-14px_rgba(28,31,35,0.55),0_1px_2px_rgba(28,31,35,0.08)] transition hover:bg-[#f8f8f8] disabled:cursor-not-allowed disabled:bg-[#f4f3f1] disabled:text-[rgba(28,31,35,0.34)]'
                  aria-label={mode === 'edit' ? t('编辑图片') : t('生成图片')}
                >
                  <ArrowUp className='size-4' />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Lightbox = ({
  images,
  currentIndex,
  open,
  onOpenChange,
  onIndexChange,
}) => {
  if (!open || images.length === 0) return null;
  const current = images[currentIndex] || images[0];

  return (
    <div className='fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-4'>
      {images.length > 1 ? (
        <>
          <button
            type='button'
            className='absolute left-4 top-1/2 hidden h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-2xl text-white backdrop-blur transition hover:bg-white/20 md:flex'
            onClick={() =>
              onIndexChange((currentIndex - 1 + images.length) % images.length)
            }
          >
            ‹
          </button>
          <button
            type='button'
            className='absolute right-4 top-1/2 hidden h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-2xl text-white backdrop-blur transition hover:bg-white/20 md:flex'
            onClick={() => onIndexChange((currentIndex + 1) % images.length)}
          >
            ›
          </button>
        </>
      ) : null}
      <div className='relative'>
        <button
          type='button'
          className='absolute right-2 top-2 z-[1210] inline-flex size-11 cursor-pointer items-center justify-center rounded-full border border-[rgba(255,255,255,0.92)] bg-[#ffffff] text-[#111111] shadow-[0_10px_28px_-16px_rgba(0,0,0,0.65),0_1px_3px_rgba(0,0,0,0.18)] transition hover:bg-[#f4f4f4] sm:-right-5 sm:-top-5'
          onClick={() => onOpenChange(false)}
          aria-label='Close'
        >
          <X className='size-5' />
        </button>
        <img
          src={current.src}
          alt=''
          className='max-h-[88vh] max-w-[92vw] object-contain'
        />
      </div>
    </div>
  );
};

const ImageStudio = ({
  mode,
  onModeChange,
  imageInputs,
  onImageInputChange,
  models,
  imageHistory,
  imageEditFiles,
  onImageEditFilesChange,
  onSubmit,
  onClearHistory,
  onRemoveBatch,
  isAnyLoading,
  imageStorageSupported,
  imageStorageMode,
  imageDirectoryName,
  imageStoragePermission,
  onChooseImageDirectory,
  onClearImageDirectory,
}) => {
  const { t } = useTranslation();
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [draftConversation, setDraftConversation] = useState(null);
  const [referenceImages, setReferenceImages] = useState([]);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [cacheSettingsOpen, setCacheSettingsOpen] = useState(false);

  const storedConversations = useMemo(
    () => buildConversations(imageHistory, t),
    [imageHistory, t],
  );
  const conversations = useMemo(() => {
    if (
      draftConversation &&
      !storedConversations.some((item) => item.id === draftConversation.id)
    ) {
      return [draftConversation, ...storedConversations];
    }
    return storedConversations;
  }, [draftConversation, storedConversations]);

  useEffect(() => {
    if (
      draftConversation &&
      storedConversations.some((item) => item.id === draftConversation.id)
    ) {
      setDraftConversation(null);
    }
  }, [draftConversation, storedConversations]);

  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedConversationId(null);
      return;
    }
    if (
      !selectedConversationId ||
      !conversations.some((item) => item.id === selectedConversationId)
    ) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, selectedConversationId]);

  const selectedConversation =
    conversations.find((item) => item.id === selectedConversationId) ||
    (conversations.length > 0 ? conversations[0] : null);

  const composerMode =
    mode === PLAYGROUND_MODES.IMAGE_EDIT ? 'edit' : 'generate';
  const imageCount = String(imageInputs?.n || 1);
  const imageSize = normalizeSizeForUi(imageInputs?.size);
  const activeTaskCount = (imageHistory || []).filter(
    (batch) => batch?.status === 'loading',
  ).length;
  const hasCacheDirectory =
    imageStorageSupported &&
    imageStorageMode === 'filesystem' &&
    imageStoragePermission === 'granted' &&
    Boolean(imageDirectoryName);

  const showCacheDirectoryRequired = () => {
    if (!imageStorageSupported) {
      Modal.warning({
        title: t('当前浏览器不支持本地缓存目录'),
        content: t('请使用支持目录授权的浏览器后再发送提示词。'),
        okText: t('知道了'),
      });
      return false;
    }

    if (hasCacheDirectory) return true;

    Modal.warning({
      title: t('请先设置本地缓存目录'),
      content: (
        <div className='space-y-2 text-sm leading-6 text-stone-600'>
          <p>{t('发送提示词前，需要先选择本地缓存目录。')}</p>
          <p>
            {t('请点击页面右上角“新建对话”右侧的配置按钮，选择本地目录后再发送。')}
          </p>
          <p className='text-xs leading-5 text-stone-500'>
            {t('这是为了数据隐私安全，图片资源会保存到你授权的本地目录中。')}
          </p>
        </div>
      ),
      okText: t('去设置'),
      cancelText: t('取消'),
      onOk: () => setCacheSettingsOpen(true),
    });
    return false;
  };

  const handleModeChange = (nextMode) => {
    onModeChange?.(
      nextMode === 'edit'
        ? PLAYGROUND_MODES.IMAGE_EDIT
        : PLAYGROUND_MODES.IMAGE_GENERATION,
    );
  };

  const handleReferenceImageChange = useCallback(
    async (files) => {
      const imageFiles = Array.from(files || [])
        .filter((file) => file.type?.startsWith('image/'))
        .slice(0, IMAGE_EDIT_MAX_FILES);
      if (imageFiles.length === 0) return;

      const mergedFiles = [...(imageEditFiles || []), ...imageFiles].slice(
        0,
        IMAGE_EDIT_MAX_FILES,
      );
      onImageEditFilesChange?.(mergedFiles);

      const previews = await Promise.all(
        mergedFiles.map(async (file) => ({
          name: file.name,
          dataUrl: await fileToDataUrl(file),
        })),
      );
      setReferenceImages(previews);
      handleModeChange('edit');
    },
    [imageEditFiles, onImageEditFilesChange],
  );

  const handleRemoveReferenceImage = (index) => {
    const nextFiles = (imageEditFiles || []).filter((_, i) => i !== index);
    onImageEditFilesChange?.(nextFiles);
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
    if (nextFiles.length === 0) {
      handleModeChange('generate');
    }
  };

  useEffect(() => {
    let alive = true;
    const syncReferenceImages = async () => {
      const previews = await Promise.all(
        (imageEditFiles || []).map(async (file) => ({
          name: file.name,
          dataUrl: await fileToDataUrl(file),
        })),
      );
      if (alive) setReferenceImages(previews);
    };
    void syncReferenceImages();
    return () => {
      alive = false;
    };
  }, [imageEditFiles]);

  const handleCreateDraft = () => {
    const draft = createFallbackConversation(t, createDraftConversationId());
    setDraftConversation(draft);
    setSelectedConversationId(draft.id);
    onImageInputChange('prompt', '');
    onImageEditFilesChange?.([]);
    setReferenceImages([]);
    handleModeChange('generate');
  };

  const handleSelectConversation = (conversationId) => {
    setSelectedConversationId(conversationId);
  };

  const handleDeleteConversation = (conversationId) => {
    if (draftConversation?.id === conversationId) {
      setDraftConversation(null);
      setSelectedConversationId(null);
      return;
    }
    const conversation = conversations.find((item) => item.id === conversationId);
    if (conversation?.turns?.length > 0) {
      conversation.turns.forEach((turn) => onRemoveBatch?.(turn.id));
      return;
    }
    onRemoveBatch?.(conversationId);
  };

  const handleClearConversations = () => {
    setDraftConversation(null);
    setSelectedConversationId(null);
    onClearHistory?.();
  };

  const handleContinueEdit = async (image) => {
    try {
      const file = await imageResultToFile(image);
      const dataUrl = image?.src?.startsWith('data:')
        ? image.src
        : await fileToDataUrl(file);
      onImageEditFilesChange?.([file]);
      setReferenceImages([{ name: file.name, dataUrl }]);
      handleModeChange('edit');
      textareaRef.current?.focus();
    } catch (error) {
      console.error('Failed to add image to edit:', error);
      Toast.error(t('无法将图片加入编辑'));
    }
  };

  const openLightbox = (images, index) => {
    setLightboxImages(images);
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const handleSubmit = () => {
    if (!showCacheDirectoryRequired()) return;
    onSubmit?.({
      conversationId: selectedConversation?.id || null,
    });
  };

  const handleResendPrompt = (turn, nextPrompt) => {
    if (!showCacheDirectoryRequired()) return;
    onSubmit?.({
      conversationId: selectedConversation?.id || null,
      prompt: nextPrompt,
      mode: turn?.mode === 'edit' ? PLAYGROUND_MODES.IMAGE_EDIT : PLAYGROUND_MODES.IMAGE_GENERATION,
    });
  };

  return (
    <>
      <section className='ml-0 mr-0 mt-[60px] grid h-[calc(100vh-5rem)] min-h-0 w-full max-w-none grid-cols-1 gap-3 bg-white px-3 pb-6 pt-4 text-stone-950 dark:bg-zinc-950 dark:text-stone-100 lg:grid-cols-[180px_minmax(0,1fr)] lg:pl-0 lg:pr-3'>
        <div className='hidden h-full min-h-0 border-r border-r-[rgba(28,31,35,0.04)] pr-2 dark:border-r-[rgba(255,255,255,0.06)] lg:block'>
          <ImageSidebar
            conversations={conversations}
            selectedConversationId={selectedConversation?.id || null}
            onClearHistory={handleClearConversations}
            onSelectConversation={handleSelectConversation}
            onDeleteConversation={handleDeleteConversation}
            t={t}
          />
        </div>

        <div className='flex min-h-0 flex-col gap-3 sm:gap-4'>
          <div className='flex items-center justify-end gap-3'>
            <button
              type='button'
              className='inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[rgba(28,31,35,0.06)] bg-white px-4 text-sm text-stone-700 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-zinc-950 dark:text-stone-200 lg:hidden'
            >
              <History className='size-4' />
              {t('历史记录')} ({conversations.length})
            </button>
            <button
              type='button'
              className='inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[rgba(28,31,35,0.06)] bg-[#ffffff] px-4 text-sm font-medium text-[#1c1f23] shadow-sm transition hover:bg-[#f8f8f8] dark:border-[rgba(255,255,255,0.08)] dark:bg-zinc-950 dark:text-[#f4f4f5]'
              onClick={handleCreateDraft}
            >
              <MessageSquarePlus className='size-4' />
              {t('新建对话')}
            </button>
            <button
              type='button'
              className='inline-flex h-10 cursor-pointer items-center justify-center rounded-2xl border border-[rgba(28,31,35,0.06)] bg-[#ffffff] px-3 text-[#1c1f23] shadow-sm transition hover:bg-[#f8f8f8] dark:border-[rgba(255,255,255,0.08)] dark:bg-zinc-950 dark:text-[#f4f4f5]'
              onClick={() => setCacheSettingsOpen(true)}
              aria-label={t('资源缓存配置')}
            >
              <Settings2 className='size-4' />
            </button>
            <button
              type='button'
              className='inline-flex h-10 cursor-pointer items-center justify-center rounded-2xl border border-[rgba(28,31,35,0.06)] bg-white px-3 text-stone-600 shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-[rgba(255,255,255,0.08)] dark:bg-zinc-950 dark:text-stone-300 lg:hidden'
              onClick={handleClearConversations}
              disabled={conversations.length === 0}
            >
              <Trash2 className='size-4' />
            </button>
          </div>

          <div className='image-list-scroll min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-4 sm:py-4'>
            <ImageResults
              selectedConversation={
                selectedConversation || createFallbackConversation(t)
              }
              onOpenLightbox={openLightbox}
              onContinueEdit={handleContinueEdit}
              onResendPrompt={handleResendPrompt}
              t={t}
            />
          </div>

          <ImageComposer
            mode={composerMode}
            prompt={imageInputs?.prompt || ''}
            model={imageInputs?.model || 'gpt-image-2'}
            models={models}
            imageCount={imageCount}
            imageSize={imageSize}
            activeTaskCount={
              isAnyLoading ? Math.max(1, activeTaskCount) : activeTaskCount
            }
            referenceImages={referenceImages}
            textareaRef={textareaRef}
            fileInputRef={fileInputRef}
            onPromptChange={(value) => onImageInputChange('prompt', value)}
            onModelChange={(value) => onImageInputChange('model', value)}
            onImageCountChange={(value) =>
              onImageInputChange(
                'n',
                Math.max(1, Math.min(10, Number(value) || 1)),
              )
            }
            onImageSizeChange={(value) =>
              onImageInputChange('size', denormalizeSizeFromUi(value))
            }
            onSubmit={handleSubmit}
            onPickReferenceImage={() => fileInputRef.current?.click()}
            onReferenceImageChange={handleReferenceImageChange}
            onRemoveReferenceImage={handleRemoveReferenceImage}
            t={t}
          />
        </div>
      </section>

      <Lightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />

      <Modal
        visible={cacheSettingsOpen}
        title={t('资源缓存配置')}
        onCancel={() => setCacheSettingsOpen(false)}
        footer={null}
        maskClosable
        centered
      >
        <div className='space-y-3 pb-3 pt-1'>
          <div className='rounded-2xl border border-[rgba(28,31,35,0.06)] bg-black/[0.02] p-3 text-sm text-stone-600 dark:border-[rgba(255,255,255,0.08)] dark:bg-white/[0.04] dark:text-stone-300'>
            <p className='mb-3 text-xs leading-5 text-stone-500'>
              {t('为了数据隐私安全，生成图片资源需要保存到你授权的本地目录中。')}
            </p>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <span>{t('缓存目录')}</span>
              <span className='font-medium text-stone-900 dark:text-stone-100'>
                {imageDirectoryName || t('未选择')}
              </span>
            </div>
            <div className='mt-1 text-xs text-stone-500'>
              {t('状态')}: {imageStorageMode || 'indexeddb'} /{' '}
              {imageStoragePermission || 'prompt'}
            </div>
            <p className='mt-2 text-xs leading-5 text-stone-500'>
              {t('点击下方按钮选择本地目录，生成图片资源会缓存到授权目录中。')}
            </p>
          </div>

          <div className='flex flex-wrap gap-2 pb-1'>
            <div className='flex gap-2'>
              <button
                type='button'
                className='inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-[rgba(28,31,35,0.08)] bg-[#ffffff] px-3 text-sm text-[#1c1f23] transition hover:bg-[#f8f8f8] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[rgba(255,255,255,0.08)] dark:bg-zinc-950 dark:text-stone-100'
                disabled={!imageStorageSupported}
                onClick={() => void onChooseImageDirectory?.()}
              >
                {t('选择本地目录')}
              </button>
              <button
                type='button'
                className='inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-[rgba(28,31,35,0.06)] bg-transparent px-3 text-sm text-stone-500 transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[rgba(255,255,255,0.08)] dark:hover:bg-white/[0.04]'
                disabled={!imageDirectoryName}
                onClick={() => void onClearImageDirectory?.()}
              >
                {t('取消授权')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default ImageStudio;
