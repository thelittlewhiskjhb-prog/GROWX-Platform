import { apiClient } from './api-client.js';
import { supabaseAuth } from './supabase-auth.js';
import { renderAdminUsers } from './admin-users.js';
import { renderAdminPackages } from './admin-packages.js';
import { renderAdminWithdrawals } from './admin-withdrawals.js';

const state = {
  unsubscribe: null,
  metrics: null,
  users: [],
  userPackages: [],
  withdrawals: []
};

const elements = {
  status: document.querySelector('#admin-status'),
  authForm: document.querySelector('#admin-login-form'),
  authShell: document.querySelector('#admin-auth-shell'),
  dashboardShell: document.querySelector('#admin-dashboard-shell'),
  metricsRoot: document.querySelector('#admin-metrics'),
  usersRoot: document.querySelector('#admin-users-root'),
  packagesRoot: document.querySelector('#admin-packages-root'),
  withdrawalsRoot: document.querySelector('#admin-withdrawals-root'),
  logoutButton: document.querySelector('#admin-logout-button'),
  processPayoutsButton: document.querySelector('#process-payouts-button')
};

function setStatus(message, tone = 'muted') {
  if (!elements.status) return;
  elements.status.textContent = message || '';
  elements.status.dataset.tone = tone;
}

function renderMetrics(metrics) {
  elements.metricsRoot.innerHTML = `
    <div class="card-grid metrics-grid">
      <article class="card"><p>Total invested</p><p class="metric-value">$${Number(metrics.total_invested || 0).toFixed(2)}</p></article>
      <article class="card"><p>Total returned</p><p class="metric-value">$${Number(metrics.total_returned || 0).toFixed(2)}</p></article>
      <article class="card"><p>Fees collected</p><p class="metric-value">$${Number(metrics.total_fees_collected || 0).toFixed(2)}</p></article>
      <article class="card"><p>Pending withdrawals</p><p class="metric-value">${metrics.pending_withdrawals || 0}</p></article>
      <article class="card"><p>Active users</p><p class="metric-value">${metrics.active_users || 0}</p></article>
      <article class="card"><p>Active packages</p><p class="metric-value">${metrics.active_packages || 0}</p></article>
    </div>
  `;
}

async function refreshAdminDashboard() {
  const profile = await supabaseAuth.getProfile();
  if (profile.role !== 'admin') {
    throw new Error('This account does not have admin access.');
  }

  state.metrics = await apiClient.fetchAdminMetrics();
  state.users = await apiClient.fetchAdminUsers();
  state.userPackages = await apiClient.fetchAdminPackages();
  state.withdrawals = await apiClient.fetchAdminWithdrawals();

  renderMetrics(state.metrics);
  renderAdminUsers(elements.usersRoot, state.users);
  renderAdminPackages(elements.packagesRoot, state.userPackages);
  renderAdminWithdrawals(elements.withdrawalsRoot, state.withdrawals, {
    onReview: reviewWithdrawal
  });
}

function startRealtimeSync() {
  state.unsubscribe?.();
  state.unsubscribe = apiClient.subscribeToTables(
    'growx-admin-sync',
    ['users', 'user_packages', 'cycles', 'withdrawals', 'transactions'],
    () => refreshAdminDashboard().catch((error) => setStatus(error.message, 'danger'))
  );
}

async function resolveAdminShell() {
  const session = await supabaseAuth.getSession().catch(() => null);
  if (!session) {
    elements.authShell.hidden = false;
    elements.dashboardShell.hidden = true;
    return;
  }

  elements.authShell.hidden = true;
  elements.dashboardShell.hidden = false;
  await refreshAdminDashboard();
  startRealtimeSync();
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  try {
    setStatus('Signing in to admin dashboard…');
    await supabaseAuth.signInWithPassword({
      identifier: formData.get('identifier')?.toString().trim(),
      password: formData.get('password')?.toString()
    });
    setStatus('Signed in successfully.', 'success');
    event.currentTarget.reset();
    await resolveAdminShell();
  } catch (error) {
    setStatus(error.message || 'Admin login failed.', 'danger');
  }
}

async function reviewWithdrawal(withdrawalId, status) {
  try {
    setStatus(`Updating withdrawal to ${status}…`);
    await apiClient.reviewWithdrawal({ withdrawalId, status });
    setStatus(`Withdrawal marked as ${status}.`, 'success');
    await refreshAdminDashboard();
  } catch (error) {
    setStatus(error.message || 'Withdrawal update failed.', 'danger');
  }
}

async function handleProcessPayouts() {
  try {
    setStatus('Processing due payouts…');
    const result = await apiClient.processPayouts();
    setStatus(`Processed ${result.processed_cycles || 0} cycle payouts.`, 'success');
    await refreshAdminDashboard();
  } catch (error) {
    setStatus(error.message || 'Unable to process payouts.', 'danger');
  }
}

async function handleLogout() {
  try {
    await supabaseAuth.signOut();
    state.unsubscribe?.();
    setStatus('Signed out.', 'success');
    await resolveAdminShell();
  } catch (error) {
    setStatus(error.message || 'Unable to sign out.', 'danger');
  }
}

supabaseAuth.onAuthStateChange(() => {
  resolveAdminShell().catch((error) => setStatus(error.message, 'danger'));
});

elements.authForm?.addEventListener('submit', handleLogin);

elements.logoutButton?.addEventListener('click', handleLogout);

elements.processPayoutsButton?.addEventListener('click', handleProcessPayouts);

resolveAdminShell().catch((error) => setStatus(error.message, 'danger'));
