import { create } from 'zustand'

type ImagePlaygroundStore = {
  visible: boolean
  iframeUrl: string | null
  selectedId: number | null
  loadingKey: boolean
  setVisible: (v: boolean) => void
  setIframeUrl: (url: string | null) => void
  setSelectedId: (id: number | null) => void
  setLoadingKey: (v: boolean) => void
}

export const useImagePlaygroundStore = create<ImagePlaygroundStore>((set) => ({
  visible: false,
  iframeUrl: null,
  selectedId: null,
  loadingKey: false,
  setVisible: (visible) => set({ visible }),
  setIframeUrl: (iframeUrl) => set({ iframeUrl }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setLoadingKey: (loadingKey) => set({ loadingKey }),
}))
