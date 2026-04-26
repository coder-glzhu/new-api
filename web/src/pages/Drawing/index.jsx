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

import React, { useContext, useEffect, useCallback, useMemo } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { UserContext } from '../../context/User';
import { usePlaygroundState } from '../../hooks/playground/usePlaygroundState';
import { useImageRequest } from '../../hooks/playground/useImageRequest';
import { useDataLoader } from '../../hooks/playground/useDataLoader';
import { PLAYGROUND_MODES } from '../../constants/playground.constants';
import ImageStudio from '../../components/playground/ImageStudio';

const Drawing = () => {
  const { t } = useTranslation();
  const [userState] = useContext(UserContext);

  const state = usePlaygroundState();
  const {
    inputs,
    mode,
    imageInputs,
    imageEditFiles,
    imageHistory,
    imageStorageSupported,
    imageStorageMode,
    imageDirectoryName,
    imageStoragePermission,
    models,
    groups,
    sseSourceRef,
    handleInputChange,
    handleImageInputChange,
    addImageBatch,
    updateImageBatch,
    removeImageBatch,
    clearImageHistoryAll,
    chooseImageDirectory,
    clearImageDirectory,
    setModels,
    setGroups,
    setDebugData,
    setActiveDebugTab,
    setMode,
    setImageInputs,
    setImageEditFiles,
  } = state;

  const { generateImage, editImage } = useImageRequest({
    setDebugData,
    setActiveDebugTab,
    addImageBatch,
    updateImageBatch,
    sseSourceRef,
  });

  useDataLoader(userState, inputs, handleInputChange, setModels, setGroups);

  useEffect(() => {
    if (!Array.isArray(models) || models.length === 0) return;
    setImageInputs((prev) => {
      const exists = models.some((m) => m.value === prev.model);
      if (exists) return prev;
      const preferred =
        models.find((m) => m.value === 'gpt-image-2') ||
        models.find((m) => m.value === 'gpt-image-1') ||
        models[0];
      return { ...prev, model: preferred.value };
    });
  }, [models, setImageInputs]);

  useEffect(() => {
    if (!Array.isArray(groups) || groups.length === 0) return;
    setImageInputs((prev) => {
      if (prev.group) return prev;
      const first = groups[0];
      return { ...prev, group: first?.value || '' };
    });
  }, [groups, setImageInputs]);

  const imageMode =
    mode === PLAYGROUND_MODES.IMAGE_EDIT
      ? PLAYGROUND_MODES.IMAGE_EDIT
      : PLAYGROUND_MODES.IMAGE_GENERATION;

  const isAnyImageLoading = useMemo(
    () =>
      Array.isArray(imageHistory) &&
      imageHistory.some((batch) => batch?.status === 'loading'),
    [imageHistory],
  );

  const handleImageSubmit = useCallback(
    ({ conversationId, prompt, mode: submitMode } = {}) => {
      const nextImageInputs = {
        ...imageInputs,
        prompt: prompt ?? imageInputs?.prompt ?? '',
      };
      const hasReferenceImages =
        Array.isArray(imageEditFiles) && imageEditFiles.length > 0;
      const nextMode =
        submitMode ||
        (hasReferenceImages
          ? PLAYGROUND_MODES.IMAGE_EDIT
          : imageMode);
      if (!nextImageInputs.prompt?.trim()) {
        Toast.warning(t('请先填写提示词'));
        return;
      }
      if (!imageStorageSupported) {
        Toast.warning(t('当前浏览器不支持本地缓存目录，请使用支持目录授权的浏览器后再发送'));
        return;
      }
      const hasCacheDirectory =
        imageStorageMode === 'filesystem' &&
        imageStoragePermission === 'granted' &&
        Boolean(imageDirectoryName);
      if (!hasCacheDirectory) {
        Toast.warning(t('请先点击新建对话右侧的配置按钮，选择本地缓存目录后再发送'));
        return;
      }
      let batchId = null;
      if (nextMode === PLAYGROUND_MODES.IMAGE_EDIT) {
        if (!hasReferenceImages) {
          Toast.warning(t('请至少上传一张源图'));
          return;
        }
        batchId = editImage({
          imageInputs: nextImageInputs,
          files: imageEditFiles,
          conversationId,
        });
      } else {
        batchId = generateImage({ imageInputs: nextImageInputs, conversationId });
      }
      if (batchId && prompt === undefined) {
        setImageInputs((prev) => ({ ...prev, prompt: '' }));
      }
    },
    [
      imageInputs,
      imageEditFiles,
      imageMode,
      editImage,
      generateImage,
      imageDirectoryName,
      imageStorageMode,
      imageStoragePermission,
      imageStorageSupported,
      setImageInputs,
      t,
    ],
  );

  const handleImageModeChange = useCallback(
    (nextMode) => {
      if (!nextMode || nextMode === imageMode) return;
      setMode(nextMode);
    },
    [imageMode, setMode],
  );

  return (
    <ImageStudio
      mode={imageMode}
      onModeChange={handleImageModeChange}
      imageInputs={imageInputs}
      onImageInputChange={handleImageInputChange}
      models={models}
      groups={groups}
      imageHistory={imageHistory}
      imageEditFiles={imageEditFiles}
      onImageEditFilesChange={setImageEditFiles}
      onSubmit={handleImageSubmit}
      onClearHistory={clearImageHistoryAll}
      onRemoveBatch={removeImageBatch}
      isAnyLoading={isAnyImageLoading}
      imageStorageSupported={imageStorageSupported}
      imageStorageMode={imageStorageMode}
      imageDirectoryName={imageDirectoryName}
      imageStoragePermission={imageStoragePermission}
      onChooseImageDirectory={chooseImageDirectory}
      onClearImageDirectory={clearImageDirectory}
    />
  );
};

export default Drawing;
