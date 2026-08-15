const safeWindow = typeof window !== 'undefined' ? window : undefined;
const safeDocument = typeof document !== 'undefined' ? document : undefined;

const memoryStorage = new Map();

function getMetaValue(name) {
  return safeDocument?.querySelector(`meta[name="${name}"]`)?.content?.trim() || '';
}

function getSessionStorage() {
  if (typeof sessionStorage !== 'undefined') {
    return sessionStorage;
  }

  return {
    getItem(key) {
      return memoryStorage.has(key) ? memoryStorage.get(key) : null;
    },
    setItem(key, value) {
      memoryStorage.set(key, value);
    },
    removeItem(key) {
      memoryStorage.delete(key);
    }
  };
}

export function getGrowxSupabaseConfig() {
  const runtimeConfig = safeWindow?.__GROWX_CONFIG__ || {};

  return {
    url: runtimeConfig.supabaseUrl || getMetaValue('growx-supabase-url'),
    anonKey: runtimeConfig.supabaseAnonKey || getMetaValue('growx-supabase-anon-key')
  };
}

export function createGrowxSupabaseClient(overrides = {}) {
  if (!safeWindow?.supabase?.createClient) {
    throw new Error('Supabase client library not loaded. Include @supabase/supabase-js before this module.');
  }

  const { url, anonKey } = {
    ...getGrowxSupabaseConfig(),
    ...overrides
  };

  if (!url || !anonKey) {
    throw new Error('Missing Supabase configuration. Set growx-supabase-url and growx-supabase-anon-key.');
  }

  return safeWindow.supabase.createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      persistSession: true,
      storage: getSessionStorage(),
      storageKey: 'growx.auth.session'
    },
    global: {
      headers: {
        'X-Client-Info': 'growx-platform-web'
      }
    },
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  });
}

const initialConfig = getGrowxSupabaseConfig();

export const supabase = initialConfig.url && initialConfig.anonKey && safeWindow?.supabase?.createClient
  ? createGrowxSupabaseClient(initialConfig)
  : null;

if (safeWindow && supabase) {
  safeWindow.growxSupabase = supabase;
}
