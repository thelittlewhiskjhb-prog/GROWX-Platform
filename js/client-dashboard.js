import '../components/pin-login.js';
import '../components/terms-modal.js';
import '../components/cycle-progress.js';
import { apiClient } from './api-client.js';
import { supabaseAuth } from './supabase-auth.js';
import { storageManager } from './storage-manager.js';
import { formatCurrency, renderPackageManager } from './package-manager.js';
import { renderCycleTracker, getNextPayout } from './cycle-tracker.js';
import { renderWithdrawalManager } from './withdrawal-manager.js';
import { renderRechargeManager } from './recharge-manager.js';
import { renderGiftManager } from './gift-manager.js';
import { renderRewardManager } from './reward-manager.js';

const state = {
  session: null,
  user: null,
  profile: null,
  userPackages: [],
  withdrawals: [],
  recharges: [],
  transactions: [],
  unsubscribe: null
};

const elements = {
  status: document.querySelector('#app-status'),
  authShell: document.querySelector('#auth-shell'),
  pinShell: document.querySelector('#pin-shell'),
  dashboardShell: document.querySelector('#dashboard-shell'),
  registerForm: document.querySelector('#register-form'),
  loginForm: document.querySelector('#login-form'),
  otpForm: document.querySelector('#otp-form'),
  profileSetupCard: document.querySelector('#profile-setup-card'),
  profileSetupForm: document.querySelector('#profile-setup-form'),
  logoutButton: document.querySelector('#logout-button'),
  pinLogin: document.querySelector('pin-login'),
  stats: {
    balance: document.querySelector('#wallet-balance'),
    rewards: document.querySelector('#reward-balance'),
    nextPayout: document.querySelector('#next-payout'),
    activePackages: document.querySelector('#active-packages')
  },
  cycleRoot: document.querySelector('#cycle-root'),
  rechargeRoot: document.querySelector('#recharge-root'),
  withdrawalsRoot: document.querySelector('#withdrawals-root'),
  giftRoot: document.querySelector('#gift-root'),
  rewardRoot: document.querySelector('#reward-root'),
  transactionsRoot: document.querySelector('#transactions-root')
};

function setStatus(message, tone = 'muted') {
  if (!elements.status) return;
  elements.status.textContent = message || '';
  elements.status.dataset.tone = tone;
}

function toggleShell(shell) {
  elements.authShell.hidden = shell !== 'auth';
  elements.pinShell.hidden = shell !== 'pin';
  elements.dashboardShell.hidden = shell !== 'dashboard';
  if (shell !== 'auth') {
    elements.profileSetupCard.hidden = true;
  }
  storageManager.setScreen(shell);
}

function renderTransactions() {
  elements.transactionsRoot.innerHTML = `
    <div class="card">
      <h2>Recent transactions</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${state.transactions.length ? state.transactions.map((item) => `
              <tr>
                <td>${new Date(item.created_at).toLocaleString()}</td>
                <td>${item.transaction_type.replaceAll('_', ' ')}</td>
                <td>${formatCurrency(item.amount)}</td>
                <td>${item.description || '—'}</td>
              </tr>
            `).join('') : '<tr><td colspan="4">No transactions yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function refreshDashboard() {
  state.profile = await apiClient.fetchProfile();
  state.userPackages = await apiClient.fetchClientPackages();
  state.withdrawals = await apiClient.fetchWithdrawals();
  state.recharges = await apiClient.fetchRechargeRequests();
  state.transactions = await apiClient.fetchTransactions();

  const activeCount = state.userPackages.filter((item) => item.status === 'active').length;
  const nextPayout = getNextPayout(state.userPackages);

  elements.stats.balance.textContent = formatCurrency(state.profile.wallet_balance);
  elements.stats.rewards.textContent = formatCurrency(state.profile.reward_balance);
  elements.stats.activePackages.textContent = String(activeCount);
  elements.stats.nextPayout.textContent = nextPayout
    ? `${formatCurrency(nextPayout.payout_amount)} · ${new Date(nextPayout.payout_date).toLocaleDateString()}`
    : 'No pending payout';

  renderCycleTracker(elements.cycleRoot, state.userPackages);
  renderPackageManager({
    container: document.querySelector('#packages-root'),
    packages: await apiClient.listPackages(),
    userPackages: state.userPackages,
    walletBalance: state.profile.wallet_balance,
    setStatus,
    onPurchased: refreshDashboard
  });
  renderRechargeManager({
    container: elements.rechargeRoot,
    recharges: state.recharges,
    setStatus,
    onSubmitted: refreshDashboard
  });

  renderWithdrawalManager({
    container: elements.withdrawalsRoot,
    profile: state.profile,
    withdrawals: state.withdrawals,
    setStatus,
    onSubmitted: refreshDashboard
  });

  renderGiftManager({
    container: elements.giftRoot,
    setStatus,
    onRedeemed: refreshDashboard
  });

  await renderRewardManager({
    container: elements.rewardRoot,
    setStatus,
    onClaimed: refreshDashboard
  });

  renderTransactions();
}

function startRealtimeSync() {
  state.unsubscribe?.();
  state.unsubscribe = apiClient.subscribeToTables(
    'growx-client-sync',
    ['users', 'user_packages', 'cycles', 'withdrawals', 'transactions', 'reward_claims', 'recharge_requests'],
    () => refreshDashboard().catch((error) => setStatus(error.message, 'danger'))
  );
}

async function resolveShell() {
  state.unsubscribe?.();
  state.session = await supabaseAuth.getSession().catch(() => null);
  state.user = await supabaseAuth.getUser().catch(() => null);

  if (!state.session || !state.user) {
    elements.profileSetupCard.hidden = true;
    toggleShell('auth');
    return;
  }

  state.profile = await supabaseAuth.getProfile().catch(() => null);

  if (!state.profile) {
    toggleShell('auth');
    elements.profileSetupCard.hidden = false;
    setStatus('Complete registration after email or phone verification to finish profile setup.', 'warning');
    return;
  }

  if (!storageManager.isPinVerified(state.user.id)) {
    toggleShell('pin');
    return;
  }

  toggleShell('dashboard');
  await refreshDashboard();
  startRealtimeSync();
}

async function handleProfileSetup(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  setStatus('Saving secure client profile…');

  try {
    await apiClient.upsertMyProfile({
      fullName: formData.get('fullName')?.toString().trim(),
      phone: formData.get('phone')?.toString().trim(),
      pin: formData.get('pin')?.toString().trim()
    });
    setStatus('Profile saved. Enter your 4-digit PIN to unlock the dashboard.', 'success');
    event.currentTarget.reset();
    await resolveShell();
  } catch (error) {
    setStatus(error.message || 'Unable to complete profile setup.', 'danger');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const submitBtn = event.currentTarget.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  setStatus('Creating your secure account…');

  try {
    const result = await supabaseAuth.registerClient({
      fullName: formData.get('fullName')?.toString().trim(),
      email: formData.get('email')?.toString().trim(),
      phone: formData.get('phone')?.toString().trim(),
      password: formData.get('password')?.toString(),
      pin: formData.get('pin')?.toString().trim()
    });

    if (!result.session) {
      setStatus('Registration started. Confirm your email or SMS verification, then sign in and enter your 4-digit PIN.', 'success');
      event.currentTarget.reset();
      return;
    }

    setStatus('Account created. Please unlock the dashboard with your 4-digit PIN.', 'success');
    event.currentTarget.reset();
    await resolveShell();
  } catch (error) {
    setStatus(error.message || 'Registration failed.', 'danger');
  } finally {
    submitBtn.disabled = false;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const submitBtn = event.currentTarget.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  setStatus('Signing in…');

  try {
    await supabaseAuth.signInWithPassword({
      identifier: formData.get('identifier')?.toString().trim(),
      password: formData.get('password')?.toString()
    });
    setStatus('Sign-in successful. Enter your 4-digit PIN to continue.', 'success');
    event.currentTarget.reset();
    await resolveShell();
  } catch (error) {
    setStatus(error.message || 'Sign-in failed.', 'danger');
  } finally {
    submitBtn.disabled = false;
  }
}

async function handleOtp(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const phone = formData.get('otpPhone')?.toString().trim();
  const token = formData.get('otpToken')?.toString().trim();
  const submitBtn = event.currentTarget.querySelector('[type="submit"]');
  submitBtn.disabled = true;

  try {
    if (token) {
      await supabaseAuth.verifyPhoneOtp({ phone, token });
      setStatus('Phone verification complete. Enter your 4-digit PIN to continue.', 'success');
      await resolveShell();
      return;
    }

    await supabaseAuth.sendPhoneOtp(phone);
    setStatus('OTP sent to your phone. Enter the code to finish phone login.', 'success');
  } catch (error) {
    setStatus(error.message || 'Phone authentication failed.', 'danger');
  } finally {
    submitBtn.disabled = false;
  }
}

async function handlePin(event) {
  const pin = event.detail?.pin;
  elements.pinLogin.setStatus('Checking PIN…');

  try {
    const valid = await supabaseAuth.verifyPin(pin);
    if (!valid) {
      elements.pinLogin.setStatus('Incorrect PIN. Please try again.', 'danger');
      return;
    }

    elements.pinLogin.setStatus('PIN accepted.', 'success');
    await resolveShell();
  } catch (error) {
    elements.pinLogin.setStatus(error.message || 'PIN verification failed.', 'danger');
  }
}

async function handleLogout() {
  try {
    await supabaseAuth.signOut();
    state.unsubscribe?.();
    setStatus('Signed out successfully.', 'success');
    await resolveShell();
  } catch (error) {
    setStatus(error.message || 'Unable to sign out.', 'danger');
  }
}

supabaseAuth.onAuthStateChange(() => {
  resolveShell().catch((error) => setStatus(error.message, 'danger'));
});

elements.registerForm?.addEventListener('submit', handleRegister);
elements.loginForm?.addEventListener('submit', handleLogin);
elements.otpForm?.addEventListener('submit', handleOtp);
elements.profileSetupForm?.addEventListener('submit', handleProfileSetup);
elements.pinLogin?.addEventListener('pin-submit', handlePin);
elements.logoutButton?.addEventListener('click', handleLogout);

// Wire up static copy buttons for the recharge addresses section
document.querySelectorAll('.copy-button[data-copy-target]').forEach((button) => {
  button.addEventListener('click', async () => {
    const targetId = button.dataset.copyTarget;
    const text = document.getElementById(targetId)?.textContent?.trim();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied!';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('copied');
      }, 2000);
    } catch {
      button.textContent = 'Failed';
      setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    }
  });
});

resolveShell().catch((error) => setStatus(error.message, 'danger'));
