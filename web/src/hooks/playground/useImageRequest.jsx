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

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SSE } from 'sse.js';
import {
  API_ENDPOINTS,
  DEBUG_TABS,
  PLAYGROUND_MODES,
} from '../../constants/playground.constants';
import { getUserIdFromLocalStorage, handleApiError } from '../../helpers';

// 把后端返回的 data 数组规整成 items
const normalizeImageItems = (dataArray) => {
  if (!Array.isArray(dataArray)) return [];
  return dataArray
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const b64_json =
        item.b64_json ||
        item.b64Json ||
        item.image_b64 ||
        item.image_base64 ||
        item.result_b64 ||
        null;
      const url = item.url || item.image_url || null;
      const revised_prompt = item.revised_prompt || item.revisedPrompt || null;
      if (!b64_json && !url) return null;
      return {
        b64_json,
        url,
        revised_prompt,
      };
    })
    .filter(Boolean);
};

const collectImageItemsFromChunk = (chunk) => {
  if (!chunk || typeof chunk !== 'object') return [];

  const candidates = [];
  if (Array.isArray(chunk.data))
    candidates.push(...normalizeImageItems(chunk.data));
  if (Array.isArray(chunk.images))
    candidates.push(...normalizeImageItems(chunk.images));
  if (Array.isArray(chunk.output))
    candidates.push(...normalizeImageItems(chunk.output));
  const direct = normalizeImageItems([chunk]);
  if (direct.length > 0) candidates.push(...direct);

  const openAIImageCalls = Array.isArray(chunk.output)
    ? chunk.output.filter((item) => item?.type === 'image_generation_call')
    : [];
  openAIImageCalls.forEach((item) => {
    const result = item.result || item.image || item.b64_json || item.image_b64;
    if (result) {
      candidates.push({
        b64_json: result,
        url: null,
        revised_prompt: null,
      });
    }
  });

  return candidates;
};

// 从 SSE chunk JSON 中尝试抽取部分图（partial_image_b64）等渐进数据
const extractPartialFromChunk = (chunk) => {
  if (!chunk || typeof chunk !== 'object') return null;
  const partial =
    chunk.partial_image_b64 ||
    chunk.partial_image ||
    chunk.partial_image_b64_json ||
    chunk.b64_json ||
    chunk.b64Json ||
    chunk.image_b64 ||
    chunk.image_base64 ||
    chunk.result_b64 ||
    null;
  if (partial) {
    return [
      {
        b64_json: partial,
        url: null,
        revised_prompt: chunk.revised_prompt || null,
        partial: true,
      },
    ];
  }
  return null;
};

const newBatchId = () => {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
};

const buildPayload = ({ imageInputs, mode }) => {
  const payload = {
    model: imageInputs.model || 'gpt-image-2',
    prompt: imageInputs.prompt,
    n: Number(imageInputs.n) || 1,
    size: imageInputs.size,
    stream: !!imageInputs.stream,
  };
  if (imageInputs.response_format && imageInputs.response_format !== 'auto') {
    payload.response_format = imageInputs.response_format;
  }
  if (imageInputs.quality && imageInputs.quality !== 'auto') {
    payload.quality = imageInputs.quality;
  }
  if (imageInputs.group) {
    payload.group = imageInputs.group;
  }
  if (mode === PLAYGROUND_MODES.IMAGE_EDIT) {
    payload._mode = 'edit';
  }
  return payload;
};

export const useImageRequest = ({
  setDebugData,
  setActiveDebugTab,
  addImageBatch,
  updateImageBatch,
  sseSourceRef,
}) => {
  const { t } = useTranslation();

  const writeDebugRequest = useCallback(
    (payloadForDebug, isStream) => {
      setDebugData((prev) => ({
        ...prev,
        request: payloadForDebug,
        timestamp: new Date().toISOString(),
        response: null,
        sseMessages: isStream ? [] : null,
        isStreaming: !!isStream,
      }));
      setActiveDebugTab(DEBUG_TABS.REQUEST);
    },
    [setDebugData, setActiveDebugTab],
  );

  const writeDebugResponse = useCallback(
    (responseText) => {
      setDebugData((prev) => ({
        ...prev,
        response: responseText,
        isStreaming: false,
      }));
      setActiveDebugTab(DEBUG_TABS.RESPONSE);
    },
    [setDebugData, setActiveDebugTab],
  );

  const handleNonStream = useCallback(
    async ({ endpoint, body, isFormData, batchId }) => {
      try {
        const headers = {
          'New-Api-User': getUserIdFromLocalStorage(),
        };
        if (!isFormData) {
          headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body,
        });

        if (!response.ok) {
          let errorBody = '';
          let parsedError = null;
          try {
            errorBody = await response.text();
            const errorJson = JSON.parse(errorBody);
            if (errorJson?.error) parsedError = errorJson.error;
          } catch (_) {
            if (!errorBody) errorBody = '无法读取错误响应体';
          }

          const errorInfo = handleApiError(
            new Error(`HTTP ${response.status}: ${errorBody}`),
            response,
          );
          writeDebugResponse(JSON.stringify(errorInfo, null, 2));

          updateImageBatch(batchId, {
            status: 'error',
            error:
              parsedError?.message || `HTTP ${response.status}: ${errorBody}`,
            errorCode: parsedError?.code || null,
          });
          return;
        }

        const data = await response.json();
        writeDebugResponse(JSON.stringify(data, null, 2));

        const items = normalizeImageItems(data?.data);
        updateImageBatch(batchId, {
          status: items.length > 0 ? 'complete' : 'error',
          items,
          error: items.length === 0 ? t('未返回图片数据') : null,
          rawResponse: data,
        });
      } catch (error) {
        console.error('Image request error:', error);
        const errorInfo = handleApiError(error);
        writeDebugResponse(JSON.stringify(errorInfo, null, 2));
        updateImageBatch(batchId, {
          status: 'error',
          error: error.message || t('请求发生错误'),
        });
      }
    },
    [t, updateImageBatch, writeDebugResponse],
  );

  const handleStream = useCallback(
    ({ endpoint, payload, batchId }) => {
      const source = new SSE(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'New-Api-User': getUserIdFromLocalStorage(),
        },
        method: 'POST',
        payload: JSON.stringify(payload),
      });

      sseSourceRef.current = source;

      let responseText = '';
      let hasReceivedFirstResponse = false;
      let isStreamComplete = false;
      let aggregatedItems = [];

      source.addEventListener('message', (e) => {
        if (e.data === '[DONE]') {
          isStreamComplete = true;
          source.close();
          sseSourceRef.current = null;

          setDebugData((prev) => ({
            ...prev,
            response: responseText,
            sseMessages: [...(prev.sseMessages || []), '[DONE]'],
            isStreaming: false,
          }));
          setActiveDebugTab(DEBUG_TABS.RESPONSE);

          // 流结束时若没拿到完整 items，至少把已经收到的 partial 升级到 complete
          updateImageBatch(batchId, (prev) => ({
            status: 'complete',
            items:
              aggregatedItems.length > 0
                ? aggregatedItems
                : (prev?.items || []).map((it) => ({ ...it, partial: false })),
          }));
          return;
        }

        responseText += e.data + '\n';

        try {
          const chunk = JSON.parse(e.data);
          if (!hasReceivedFirstResponse) {
            setActiveDebugTab(DEBUG_TABS.RESPONSE);
            hasReceivedFirstResponse = true;
          }

          setDebugData((prev) => ({
            ...prev,
            sseMessages: [...(prev.sseMessages || []), e.data],
          }));

          const items = collectImageItemsFromChunk(chunk);
          if (items.length > 0) {
            aggregatedItems = items.map((item) => ({
              ...item,
              partial: false,
            }));
            updateImageBatch(batchId, {
              items: aggregatedItems,
              rawResponse: chunk,
            });
            return;
          }

          // 部分图（progress）
          const partialItems = extractPartialFromChunk(chunk);
          if (partialItems) {
            updateImageBatch(batchId, (prev) => ({
              items: partialItems,
            }));
          }
        } catch (error) {
          console.error('Failed to parse image SSE chunk:', error);
          setDebugData((prev) => ({
            ...prev,
            sseMessages: [...(prev.sseMessages || []), e.data],
          }));
        }
      });

      source.addEventListener('error', (e) => {
        if (!isStreamComplete && source.readyState !== 2) {
          let errorMessage = e?.data || t('请求发生错误');
          let errorCode = null;
          if (e?.data) {
            try {
              const errorJson = JSON.parse(e.data);
              if (errorJson?.error) {
                errorMessage = errorJson.error.message || errorMessage;
                errorCode = errorJson.error.code || null;
              }
            } catch (_) {
              // 非 JSON
            }
          }
          const errorInfo = handleApiError(new Error(errorMessage));
          errorInfo.readyState = source.readyState;

          setDebugData((prev) => ({
            ...prev,
            response:
              responseText +
              '\n\nSSE Error:\n' +
              JSON.stringify(errorInfo, null, 2),
            isStreaming: false,
          }));
          setActiveDebugTab(DEBUG_TABS.RESPONSE);

          updateImageBatch(batchId, {
            status: 'error',
            error: errorMessage,
            errorCode,
          });

          sseSourceRef.current = null;
          source.close();
        }
      });

      source.addEventListener('readystatechange', (e) => {
        if (
          e.readyState >= 2 &&
          source.status !== undefined &&
          source.status !== 200 &&
          !isStreamComplete
        ) {
          const errorInfo = handleApiError(new Error('HTTP状态错误'));
          errorInfo.status = source.status;
          errorInfo.readyState = source.readyState;

          setDebugData((prev) => ({
            ...prev,
            response:
              responseText +
              '\n\nHTTP Error:\n' +
              JSON.stringify(errorInfo, null, 2),
            isStreaming: false,
          }));
          setActiveDebugTab(DEBUG_TABS.RESPONSE);

          updateImageBatch(batchId, {
            status: 'error',
            error: t('连接已断开'),
          });
          source.close();
        }
      });

      try {
        source.stream();
      } catch (error) {
        const errorInfo = handleApiError(error);
        setDebugData((prev) => ({
          ...prev,
          response: 'Stream启动失败:\n' + JSON.stringify(errorInfo, null, 2),
          isStreaming: false,
        }));
        setActiveDebugTab(DEBUG_TABS.RESPONSE);
        updateImageBatch(batchId, {
          status: 'error',
          error: error.message || t('建立连接时发生错误'),
        });
      }
    },
    [setActiveDebugTab, setDebugData, sseSourceRef, t, updateImageBatch],
  );

  /**
   * 文生图
   * @param {{imageInputs:object}} params
   */
  const generateImage = useCallback(
    ({ imageInputs, conversationId }) => {
      if (!imageInputs?.prompt?.trim()) return null;

      const payload = buildPayload({
        imageInputs,
        mode: PLAYGROUND_MODES.IMAGE_GENERATION,
      });
      delete payload._mode;
      payload.stream = false;

      const batchId = newBatchId();
      const now = Date.now();
      const batch = {
        id: batchId,
        conversationId: conversationId || batchId,
        mode: PLAYGROUND_MODES.IMAGE_GENERATION,
        prompt: imageInputs.prompt,
        model: payload.model,
        size: imageInputs.size,
        n: payload.n,
        responseFormat: imageInputs.response_format,
        stream: payload.stream,
        items: [],
        status: 'loading',
        createdAt: now,
      };
      addImageBatch(batch);

      writeDebugRequest(payload, payload.stream);

      if (payload.stream) {
        handleStream({
          endpoint: API_ENDPOINTS.IMAGE_GENERATIONS,
          payload,
          batchId,
        });
      } else {
        handleNonStream({
          endpoint: API_ENDPOINTS.IMAGE_GENERATIONS,
          body: JSON.stringify(payload),
          isFormData: false,
          batchId,
        });
      }
      return batchId;
    },
    [addImageBatch, handleNonStream, handleStream, writeDebugRequest],
  );

  /**
   * 图片编辑（multipart）
   * @param {{imageInputs:object, files:File[]}} params
   */
  const editImage = useCallback(
    ({ imageInputs, files, conversationId }) => {
      if (!imageInputs?.prompt?.trim()) return null;
      if (!Array.isArray(files) || files.length === 0) return null;

      const payload = buildPayload({
        imageInputs,
        mode: PLAYGROUND_MODES.IMAGE_EDIT,
      });
      delete payload._mode;
      payload.stream = false;

      const batchId = newBatchId();
      const now = Date.now();

      // 给历史里展示用：把每张源图存成 dataURL（仅用于回显，不写入 localStorage 保存的 batch 中）
      const sourceMeta = files.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
      }));

      const batch = {
        id: batchId,
        conversationId: conversationId || batchId,
        mode: PLAYGROUND_MODES.IMAGE_EDIT,
        prompt: imageInputs.prompt,
        model: payload.model,
        size: imageInputs.size,
        n: payload.n,
        responseFormat: imageInputs.response_format,
        stream: payload.stream,
        items: [],
        status: 'loading',
        createdAt: now,
        sources: sourceMeta,
      };
      addImageBatch(batch);

      const fd = new FormData();
      fd.append('model', payload.model || 'gpt-image-2');
      fd.append('prompt', payload.prompt);
      fd.append('n', String(payload.n));
      if (payload.size) fd.append('size', payload.size);
      if (payload.quality) fd.append('quality', payload.quality);
      if (payload.response_format)
        fd.append('response_format', payload.response_format);
      if (payload.stream) fd.append('stream', 'true');
      if (payload.group) fd.append('group', payload.group);
      files.forEach((file) => {
        fd.append('image', file, file.name);
      });

      // FormData 不便于直接展示，把元数据写进 debug request
      writeDebugRequest(
        {
          ...payload,
          _multipart: true,
          images: sourceMeta,
        },
        payload.stream,
      );

      if (payload.stream) {
        // SSE.js 不支持 FormData payload，编辑时即便用户开了 stream 也走非流式
        handleNonStream({
          endpoint: API_ENDPOINTS.IMAGE_EDITS,
          body: fd,
          isFormData: true,
          batchId,
        });
      } else {
        handleNonStream({
          endpoint: API_ENDPOINTS.IMAGE_EDITS,
          body: fd,
          isFormData: true,
          batchId,
        });
      }
      return batchId;
    },
    [addImageBatch, handleNonStream, writeDebugRequest],
  );

  /**
   * 中止当前流式请求
   */
  const abortImageRequest = useCallback(() => {
    if (sseSourceRef.current) {
      try {
        sseSourceRef.current.close();
      } catch (_) {
        // ignore
      }
      sseSourceRef.current = null;
    }
  }, [sseSourceRef]);

  return {
    generateImage,
    editImage,
    abortImageRequest,
  };
};

export default useImageRequest;
