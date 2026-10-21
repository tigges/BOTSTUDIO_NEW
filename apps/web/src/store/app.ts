import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { APP_STORAGE_KEY, migrateLegacyStorage } from '../lib/storage-keys'

export interface CurrentUser {
  id: string
  email: string
  displayName: string
  avatarUrl?: string | null
  tenantId: string
  role: string
}

export interface Bot {
  id: string
  name: string
  personaName?: string | null
  description?: string | null
  avatarUrl?: string | null
  status: string
  environments: Array<{
    id: string
    kind: string
    name: string
  }>
}

/** Keep the saved bot when it is still in the list. Otherwise use the first bot. */
export function selectedBotAfterLoad(current: string | null, bots: Array<{ id: string }>): string | null {
  if (current && bots.some((bot) => bot.id === current)) return current
  return bots[0]?.id ?? null
}

interface AppStore {
  user: CurrentUser | null
  token: string | null
  bots: Bot[]
  botsLoading: boolean
  botsError: string | null
  selectedBotId: string | null
  selectedEnv: 'sandbox' | 'production'

  setAuth: (user: CurrentUser, token: string) => void
  clearAuth: () => void
  setBots: (bots: Bot[]) => void
  setBotsLoading: (loading: boolean) => void
  setBotsError: (message: string | null) => void
  selectBot: (botId: string) => void
  setEnv: (env: 'sandbox' | 'production') => void
}

migrateLegacyStorage()

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      bots: [],
      botsLoading: false,
      botsError: null,
      selectedBotId: null,
      selectedEnv: 'sandbox',

      setAuth: (user, token) => set({ user, token }),
      clearAuth: () => set({ user: null, token: null, bots: [], botsLoading: false, botsError: null, selectedBotId: null }),
      setBots: (bots) =>
        set((state) => ({
          bots,
          botsLoading: false,
          botsError: null,
          selectedBotId: selectedBotAfterLoad(state.selectedBotId, bots),
        })),
      setBotsLoading: (loading) => set({ botsLoading: loading }),
      setBotsError: (message) => set({ botsError: message, botsLoading: false }),
      selectBot: (botId) => set({ selectedBotId: botId }),
      setEnv: (env) => set({ selectedEnv: env }),
    }),
    {
      name: APP_STORAGE_KEY,
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        selectedBotId: state.selectedBotId,
        selectedEnv: state.selectedEnv,
      }),
    }
  )
)
