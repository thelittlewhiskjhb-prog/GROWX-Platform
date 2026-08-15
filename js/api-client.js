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
    return unwrap(
      getClient().from('packages').select('*').eq('active', true).order('amount', { ascending: true })
    );
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

  // ── Recharge ─────────────────────────────────────────────

  async fetchDepositAddresses() {
    return unwrap(
      getClient()
        .from('deposit_addresses')
        .select('network, address')
        .eq('active', true)
    );
  },

  async createRechargeRequest({ amount, network }) {
    return unwrap(
      getClient().rpc('create_recharge_request', {
        p_amount: Number(amount),
        p_network: network
      })
    );
  },

  async fetchRechargeRequests() {
    return unwrap(
      getClient()
        .from('recharge_requests')
        .select('*')
        .order('created_at', { ascending: false })
    );
  },

  // ── Daily reward ─────────────────────────────────────────

  async claimDailyReward() {
    return unwrap(getClient().rpc('claim_daily_reward'));
  },

  async fetchLastRewardClaim() {
    return unwrap(
      getClient()
        .from('reward_claims')
        .select('claimed_at, amount')
        .order('claimed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );
  },

  // ── Gift codes ────────────────────────────────────────────

  async redeemGiftCode(code) {
    return unwrap(getClient().rpc('redeem_gift_code', { p_code: code }));
  },

  // ── Withdrawals ───────────────────────────────────────────

  async requestWithdrawal(amount, walletAddress, networkType) {
    return unwrap(
      getClient().rpc('request_withdrawal', {
        p_amount: Number(amount),
        p_wallet: (walletAddress || '').trim(),
        p_network: networkType || ''
      })
    );
  },

  // ── Admin ─────────────────────────────────────────────────

  async fetchAdminUsers({ page = 1, pageSize = 25, search = '' } = {}) {
    return unwrap(
      getClient().rpc('admin_list_users', {
        p_search: search || null,
        p_page: Number(page),
        p_page_size: Number(pageSize)
      })
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
        .select('*, users(full_name, phone, client_code)')
        .order('requested_at', { ascending: false })
    );
  },

  async fetchAdminRecharges() {
    return unwrap(
      getClient()
        .from('recharge_requests')
        .select('*, users(full_name, phone, client_code)')
        .order('created_at', { ascending: false })
    );
  },

  async fetchAdminMetrics() {
    return unwrap(getClient().rpc('admin_dashboard_metrics'));
  },

  async reviewWithdrawal({ withdrawalId, status, notes, transactionHash }) {
    return unwrap(
      getClient().functions.invoke('process-withdrawal', {
        body: {
          action: 'review',
          withdrawalId,
          status,
          notes: notes || null,
          transactionHash: transactionHash || null
        }
      })
    );
  },

  async verifyRecharge({ rechargeId, action, adminNotes }) {
    return unwrap(
      getClient().functions.invoke('verify-recharge', {
        body: { rechargeId, action, adminNotes: adminNotes || null }
      })
    );
  },

  async processPayouts() {
    return unwrap(
      getClient().functions.invoke('process-payouts', {
        body: { source: 'admin-dashboard' }
      })
    );
  },

  async adminCreditWallet({ userId, amount, description }) {
    return unwrap(
      getClient().rpc('admin_credit_wallet', {
        p_user_id: userId,
        p_amount: Number(amount),
        p_description: description || 'Admin fund transfer'
      })
    );
  },

  async adminResetPassword(email) {
    return unwrap(
      getClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/index.html`
      })
    );
  },

  // Replaced unsafe direct-table update with server-side RPC
  async adminToggleUserStatus({ userId, newStatus }) {
    return unwrap(
      getClient().rpc('admin_set_user_status', {
        p_user_id: userId,
        p_status: newStatus
      })
    );
  },

  async adminAllocatePackage({ clientUserId, packageId }) {
    return unwrap(
      getClient().functions.invoke('admin-allocate-package', {
        body: { clientUserId, packageId }
      })
    );
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
