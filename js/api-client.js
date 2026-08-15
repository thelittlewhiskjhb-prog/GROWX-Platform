import { supabase } from '../supabase-config.js';

function getClient() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add your URL and anon key to the page or window.__GROWX_CONFIG__.');
  }

  return supabase;
}

async function unwrap(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

export const apiClient = {
  async fetchProfile() {
    return unwrap(getClient().from('users').select('*').single());
  },

  async upsertMyProfile({ fullName, phone, pin }) {
    return unwrap(getClient().rpc('upsert_my_profile', {
      p_full_name: fullName || null,
      p_phone: phone || null,
      p_pin: pin || null
    }));
  },

  async verifyPin(pin) {
    return unwrap(getClient().rpc('verify_user_pin', { p_pin: pin }));
  },

  async listPackages() {
    return unwrap(getClient().from('packages').select('*').eq('active', true).order('amount', { ascending: true }));
  },

  async purchasePackage(packageId) {
    return unwrap(getClient().rpc('purchase_package', { p_package_id: packageId }));
  },

  async fetchClientPackages() {
    return unwrap(
      getClient()
        .from('user_packages')
        .select('*, packages(*), cycles(*)')
        .order('purchased_at', { ascending: false })
    );
  },

  async fetchWithdrawals() {
    return unwrap(
      getClient()
        .from('withdrawals')
        .select('*')
        .order('requested_at', { ascending: false })
    );
  },

  async fetchTransactions(limit = 12) {
    return unwrap(
      getClient()
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
    );
  },

  async fetchAdminUsers() {
    return unwrap(
      getClient()
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
    );
  },

  async fetchAdminPackages() {
    return unwrap(
      getClient()
        .from('user_packages')
        .select('*, packages(name, amount), users(full_name, phone), cycles(*)')
        .order('purchased_at', { ascending: false })
    );
  },

  async fetchAdminWithdrawals() {
    return unwrap(
      getClient()
        .from('withdrawals')
        .select('*, users(full_name, phone)')
        .order('requested_at', { ascending: false })
    );
  },

  async fetchAdminMetrics() {
    return unwrap(getClient().rpc('admin_dashboard_metrics'));
  },

  async requestWithdrawal(amount, walletAddress, networkType) {
    return unwrap(getClient().functions.invoke('process-withdrawal', {
      body: {
        action: 'request',
        amount: Number(amount),
        walletAddress: walletAddress || null,
        networkType: networkType || null
      }
    }));
  },

  async reviewWithdrawal({ withdrawalId, status, notes }) {
    return unwrap(getClient().functions.invoke('process-withdrawal', {
      body: {
        action: 'review',
        withdrawalId,
        status,
        notes: notes || null
      }
    }));
  },

  async processPayouts() {
    return unwrap(getClient().functions.invoke('process-payouts', {
      body: {
        source: 'admin-dashboard'
      }
    }));
  },

  async recordGrowRushReward(amount) {
    return unwrap(getClient().rpc('record_grow_rush_reward', {
      p_reward_amount: Number(amount)
    }));
  },

  subscribeToTables(channelName, tables, callback) {
    const channel = getClient().channel(channelName);

    tables.forEach((table) => {
      channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table
      }, callback);
    });

    channel.subscribe();

    return () => {
      getClient().removeChannel(channel);
    };
  }
};
