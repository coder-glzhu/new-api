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

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_MESSAGES,
  getDefaultMessages,
  DEFAULT_CONFIG,
  DEFAULT_IMAGE_INPUTS,
  DEBUG_TABS,
  MESSAGE_STATUS,
  PLAYGROUND_MODES,
  IMAGE_HISTORY_MAX_BATCHES,
} from '../../constants/playground.constants';
import {
  loadConfig,
  saveConfig,
  loadMessages,
  saveMessages,
  loadImageHistory,
  saveImageHistory,
  hydrateImageHistory,
  clearImageHistory,
  isFileSystemStorageSupported,
  saveImageDirectoryHandle,
  loadImageDirectoryHandle,
  clearImageDirectoryHandle,
  requestImageDirectoryPermission,
  saveImageBatchToDirectory,
  hydrateFileSystemImageHistory,
} from '../../components/playground/configStorage';
import { processIncompleteThinkTags } from '../../helpers';

export const usePlaygroundState = () => {
  const { t } = useTranslation();

  // 使用惰性初始化，确保只在组件首次挂载时加载配置和消息
  const [savedConfig] = useState(() => loadConfig());
  const [initialMessages] = useState(() => {
    const loaded = loadMessages();
    // 检查是否是旧的中文默认消息，如果是则清除
    if (
      loaded &&
      loaded.length === 2 &&
      loaded[0].id === '2' &&
      loaded[1].id === '3'
    ) {
      const hasOldChinese =
        loaded[0].content === '你好' ||
        loaded[1].content === '你好，请问有什么可以帮助您的吗？' ||
        loaded[1].content === '你好！很高兴见到你。有什么我可以帮助你的吗？';

      if (hasOldChinese) {
        // 清除旧的默认消息
        localStorage.removeItem('playground_messages');
        return null;
      }
    }
    return loaded;
  });

  // 基础配置状态
  const [inputs, setInputs] = useState(
    savedConfig.inputs || DEFAULT_CONFIG.inputs,
  );
  const [parameterEnabled, setParameterEnabled] = useState(
    savedConfig.parameterEnabled || DEFAULT_CONFIG.parameterEnabled,
  );
  const [showDebugPanel, setShowDebugPanel] = useState(
    savedConfig.showDebugPanel || DEFAULT_CONFIG.showDebugPanel,
  );
  const [customRequestMode, setCustomRequestMode] = useState(
    savedConfig.customRequestMode || DEFAULT_CONFIG.customRequestMode,
  );
  const [customRequestBody, setCustomRequestBody] = useState(
    savedConfig.customRequestBody || DEFAULT_CONFIG.customRequestBody,
  );

  // 操练场模式 (chat | image_generation | image_edit)
  const [mode, setMode] = useState(savedConfig.mode || PLAYGROUND_MODES.CHAT);

  // 图片生成 / 编辑共用的输入参数
  const [imageInputs, setImageInputs] = useState(
    savedConfig.imageInputs || DEFAULT_IMAGE_INPUTS,
  );

  // 图片编辑模式上传的源图（不持久化，刷新即丢失）
  const [imageEditFiles, setImageEditFiles] = useState([]);

  const [initialImageHistory] = useState(() => loadImageHistory());

  // 图片生成历史批次（持久化）
  const [imageHistory, setImageHistory] = useState(initialImageHistory);

  // 当前正在进行中的图片批次（流式占位，不持久化）
  const [pendingImageBatch, setPendingImageBatch] = useState(null);

  const [imageStorageSupported] = useState(() =>
    isFileSystemStorageSupported(),
  );
  const [imageStorageMode, setImageStorageMode] = useState('indexeddb');
  const [imageDirectoryHandle, setImageDirectoryHandle] = useState(null);
  const [imageDirectoryName, setImageDirectoryName] = useState('');
  const [imageStoragePermission, setImageStoragePermission] = useState(
    imageStorageSupported ? 'prompt' : 'unsupported',
  );

  // UI状态
  const [showSettings, setShowSettings] = useState(false);
  const [models, setModels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [status, setStatus] = useState({});

  // 消息相关状态 - 使用加载的消息或默认消息初始化
  const [message, setMessage] = useState(
    () => initialMessages || getDefaultMessages(t),
  );

  // 当语言改变时，如果是默认消息则更新
  useEffect(() => {
    // 只在没有保存的消息时才更新默认消息
    if (!initialMessages) {
      setMessage(getDefaultMessages(t));
    }
  }, [t, initialMessages]); // 当语言改变时

  // 调试状态
  const [debugData, setDebugData] = useState({
    request: null,
    response: null,
    timestamp: null,
    previewRequest: null,
    previewTimestamp: null,
  });
  const [activeDebugTab, setActiveDebugTab] = useState(DEBUG_TABS.PREVIEW);
  const [previewPayload, setPreviewPayload] = useState(null);

  // 编辑状态
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editValue, setEditValue] = useState('');

  // Refs
  const sseSourceRef = useRef(null);
  const chatRef = useRef(null);
  const saveConfigTimeoutRef = useRef(null);
  const saveMessagesTimeoutRef = useRef(null);

  // 配置更新函数
  const handleInputChange = useCallback((name, value) => {
    setInputs((prev) => ({ ...prev, [name]: value }));
  }, []);

  // 图片输入更新
  const handleImageInputChange = useCallback((name, value) => {
    setImageInputs((prev) => ({ ...prev, [name]: value }));
  }, []);

  // 添加一个新的图片批次（生成或编辑），自动 prepend
  const addImageBatch = useCallback((batch) => {
    if (!batch) return;
    setImageHistory((prev) => {
      const next = [batch, ...prev].slice(0, IMAGE_HISTORY_MAX_BATCHES);
      saveImageHistory(next);
      return next;
    });
  }, []);

  const persistImageHistory = useCallback(
    async (next) => {
      if (
        imageStorageMode !== 'filesystem' ||
        !imageDirectoryHandle ||
        imageStoragePermission !== 'granted'
      ) {
        saveImageHistory(next);
        return;
      }

      const saved = await Promise.all(
        next.map((batch) =>
          saveImageBatchToDirectory(batch, imageDirectoryHandle),
        ),
      );
      saveImageHistory(saved);
      setImageHistory((prev) => {
        const prevIds = prev.map((batch) => batch?.id).join('|');
        const nextIds = next.map((batch) => batch?.id).join('|');
        return prevIds === nextIds ? saved : prev;
      });
    },
    [imageDirectoryHandle, imageStorageMode, imageStoragePermission],
  );

  // 更新某个批次（流式过程更新或失败标记）
  const updateImageBatch = useCallback(
    (batchId, updater) => {
      if (!batchId) return;
      setImageHistory((prev) => {
        const next = prev.map((b) =>
          b?.id === batchId
            ? {
                ...b,
                ...(typeof updater === 'function' ? updater(b) : updater),
              }
            : b,
        );
        persistImageHistory(next).catch(() => saveImageHistory(next));
        return next;
      });
    },
    [persistImageHistory],
  );

  // 删除某个批次
  const removeImageBatch = useCallback((batchId) => {
    if (!batchId) return;
    setImageHistory((prev) => {
      const next = prev.filter((b) => b?.id !== batchId);
      saveImageHistory(next);
      return next;
    });
  }, []);

  // 清空图片历史
  const clearImageHistoryAll = useCallback(() => {
    setImageHistory([]);
    clearImageHistory();
  }, []);

  const chooseImageDirectory = useCallback(async () => {
    if (!isFileSystemStorageSupported()) {
      setImageStoragePermission('unsupported');
      setImageStorageMode('indexeddb');
      return null;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const permission = await requestImageDirectoryPermission(handle);
      if (permission !== 'granted') {
        setImageStoragePermission(permission || 'denied');
        setImageStorageMode('indexeddb');
        return null;
      }

      await saveImageDirectoryHandle(handle);
      setImageDirectoryHandle(handle);
      setImageDirectoryName(handle.name || '');
      setImageStoragePermission('granted');
      setImageStorageMode('filesystem');
      return handle;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setImageStoragePermission('denied');
        setImageStorageMode('indexeddb');
      }
      return null;
    }
  }, []);

  const clearImageDirectory = useCallback(async () => {
    await clearImageDirectoryHandle().catch(() => {});
    setImageDirectoryHandle(null);
    setImageDirectoryName('');
    setImageStorageMode('indexeddb');
    setImageStoragePermission(imageStorageSupported ? 'prompt' : 'unsupported');
  }, [imageStorageSupported]);

  const handleParameterToggle = useCallback((paramName) => {
    setParameterEnabled((prev) => ({
      ...prev,
      [paramName]: !prev[paramName],
    }));
  }, []);

  // 消息保存函数 - 改为立即保存，可以接受参数
  const saveMessagesImmediately = useCallback(
    (messagesToSave) => {
      // 如果提供了参数，使用参数；否则使用当前状态
      saveMessages(messagesToSave || message);
    },
    [message],
  );

  // 配置保存
  const debouncedSaveConfig = useCallback(() => {
    if (saveConfigTimeoutRef.current) {
      clearTimeout(saveConfigTimeoutRef.current);
    }

    saveConfigTimeoutRef.current = setTimeout(() => {
      const configToSave = {
        inputs,
        parameterEnabled,
        showDebugPanel,
        customRequestMode,
        customRequestBody,
        mode,
        imageInputs,
      };
      saveConfig(configToSave);
    }, 1000);
  }, [
    inputs,
    parameterEnabled,
    showDebugPanel,
    customRequestMode,
    customRequestBody,
    mode,
    imageInputs,
  ]);

  // 配置导入/重置
  const handleConfigImport = useCallback((importedConfig) => {
    if (importedConfig.inputs) {
      const parsedMaxTokens = parseInt(importedConfig.inputs.max_tokens, 10);
      setInputs((prev) => ({
        ...prev,
        ...importedConfig.inputs,
        max_tokens: Number.isNaN(parsedMaxTokens)
          ? importedConfig.inputs.max_tokens
          : parsedMaxTokens,
      }));
    }
    if (importedConfig.parameterEnabled) {
      setParameterEnabled((prev) => ({
        ...prev,
        ...importedConfig.parameterEnabled,
      }));
    }
    if (typeof importedConfig.showDebugPanel === 'boolean') {
      setShowDebugPanel(importedConfig.showDebugPanel);
    }
    if (importedConfig.customRequestMode) {
      setCustomRequestMode(importedConfig.customRequestMode);
    }
    if (importedConfig.customRequestBody) {
      setCustomRequestBody(importedConfig.customRequestBody);
    }
    if (importedConfig.imageInputs) {
      setImageInputs((prev) => ({ ...prev, ...importedConfig.imageInputs }));
    }
    if (
      importedConfig.mode &&
      Object.values(PLAYGROUND_MODES).includes(importedConfig.mode)
    ) {
      setMode(importedConfig.mode);
    }
    // 如果导入的配置包含消息，也恢复消息
    if (importedConfig.messages && Array.isArray(importedConfig.messages)) {
      setMessage(importedConfig.messages);
    }
  }, []);

  const handleConfigReset = useCallback((options = {}) => {
    const { resetMessages = false } = options;

    setInputs(DEFAULT_CONFIG.inputs);
    setParameterEnabled(DEFAULT_CONFIG.parameterEnabled);
    setShowDebugPanel(DEFAULT_CONFIG.showDebugPanel);
    setCustomRequestMode(DEFAULT_CONFIG.customRequestMode);
    setCustomRequestBody(DEFAULT_CONFIG.customRequestBody);
    setImageInputs(DEFAULT_IMAGE_INPUTS);

    // 只有在明确指定时才重置消息
    if (resetMessages) {
      setMessage([]);
      setTimeout(() => {
        setMessage(getDefaultMessages(t));
      }, 0);
    }
  }, []);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveConfigTimeoutRef.current) {
        clearTimeout(saveConfigTimeoutRef.current);
      }
    };
  }, []);

  // 页面首次加载时，若最后一条消息仍处于 LOADING/INCOMPLETE 状态，自动修复
  useEffect(() => {
    if (!Array.isArray(message) || message.length === 0) return;

    const lastMsg = message[message.length - 1];
    if (
      lastMsg.status === MESSAGE_STATUS.LOADING ||
      lastMsg.status === MESSAGE_STATUS.INCOMPLETE
    ) {
      const processed = processIncompleteThinkTags(
        lastMsg.content || '',
        lastMsg.reasoningContent || '',
      );

      const fixedLastMsg = {
        ...lastMsg,
        status: MESSAGE_STATUS.COMPLETE,
        content: processed.content,
        reasoningContent: processed.reasoningContent || null,
        isThinkingComplete: true,
      };

      const updatedMessages = [...message.slice(0, -1), fixedLastMsg];
      setMessage(updatedMessages);

      // 保存修复后的消息列表
      setTimeout(() => saveMessagesImmediately(updatedMessages), 0);
    }
  }, []);

  // 图片历史中的 base64 结果保存在 IndexedDB，首屏先展示元数据，再异步补齐图片内容
  useEffect(() => {
    let cancelled = false;
    const initialIds = initialImageHistory.map((batch) => batch?.id).join('|');

    const loadDirectory = async () => {
      if (!imageStorageSupported) return null;
      try {
        const handle = await loadImageDirectoryHandle();
        if (!handle) return null;
        const permission = await requestImageDirectoryPermission(
          handle,
          'readwrite',
        );
        if (permission !== 'granted') {
          setImageStoragePermission(permission || 'prompt');
          return null;
        }
        if (cancelled) return null;
        setImageDirectoryHandle(handle);
        setImageDirectoryName(handle.name || '');
        setImageStoragePermission('granted');
        setImageStorageMode('filesystem');
        return handle;
      } catch (_) {
        setImageStorageMode('indexeddb');
        return null;
      }
    };

    const hydrate = async () => {
      const handle = await loadDirectory();
      let hydrated = await hydrateImageHistory(initialImageHistory);
      if (handle) {
        hydrated = await hydrateFileSystemImageHistory(hydrated, handle);
      }
      if (cancelled || !Array.isArray(hydrated)) return;
      setImageHistory((prev) => {
        if (prev.map((batch) => batch?.id).join('|') !== initialIds)
          return prev;
        const current = JSON.stringify(prev);
        const next = JSON.stringify(hydrated);
        return current === next ? prev : hydrated;
      });
    };

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [imageStorageSupported, initialImageHistory]);

  return {
    // 配置状态
    inputs,
    parameterEnabled,
    showDebugPanel,
    customRequestMode,
    customRequestBody,

    // 模式与图片相关状态
    mode,
    imageInputs,
    imageEditFiles,
    imageHistory,
    pendingImageBatch,
    imageStorageSupported,
    imageStorageMode,
    imageDirectoryName,
    imageStoragePermission,

    // UI状态
    showSettings,
    models,
    groups,
    status,

    // 消息状态
    message,

    // 调试状态
    debugData,
    activeDebugTab,
    previewPayload,

    // 编辑状态
    editingMessageId,
    editValue,

    // Refs
    sseSourceRef,
    chatRef,
    saveConfigTimeoutRef,

    // 更新函数
    setInputs,
    setParameterEnabled,
    setShowDebugPanel,
    setCustomRequestMode,
    setCustomRequestBody,
    setShowSettings,
    setModels,
    setGroups,
    setStatus,
    setMessage,
    setDebugData,
    setActiveDebugTab,
    setPreviewPayload,
    setEditingMessageId,
    setEditValue,
    setMode,
    setImageInputs,
    setImageEditFiles,
    setImageHistory,
    setPendingImageBatch,

    // 处理函数
    handleInputChange,
    handleParameterToggle,
    handleImageInputChange,
    addImageBatch,
    updateImageBatch,
    removeImageBatch,
    clearImageHistoryAll,
    chooseImageDirectory,
    clearImageDirectory,
    debouncedSaveConfig,
    saveMessagesImmediately,
    handleConfigImport,
    handleConfigReset,
  };
};
