import { apiClient } from './api-client.js';

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function hoursUntilNextClaim(lastClaimedAt) {
  if (!lastClaimedAt) return 0;
  const nextAt = new Date(lastClaimedAt).getTime() + 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((nextAt - Date.now()) / (60 * 60 * 1000)));
}

export async function renderRewardManager({ container, setStatus, onClaimed }) {
  if (!container) return;

  let lastClaim = null;

  try {
    lastClaim = await apiClient.fetchLastRewardClaim();
  } catch {
    // If no claims yet, lastClaim stays null
  }

  const hoursLeft = hoursUntilNextClaim(lastClaim?.claimed_at);
  const canClaim  = hoursLeft === 0;

  container.innerHTML = `
    <div class="card stack gap-sm">
      <h2>Daily reward</h2>
      <p>Claim your daily reward from active packages once every 24 hours.</p>
      ${lastClaim
        ? `<p class="muted-text">Last claimed: ${new Date(lastClaim.claimed_at).toLocaleString()} · ${formatCurrency(lastClaim.amount)}</p>`
        : ''}
      ${!canClaim
        ? `<p class="muted-text">Next claim available in approximately <strong>${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}</strong>.</p>`
        : ''}
      <button
        id="claim-reward-btn"
        class="primary-button"
        type="button"
        ${canClaim ? '' : 'disabled'}
      >
        ${canClaim ? 'Claim daily reward' : `Available in ${hoursLeft}h`}
      </button>
      <p id="reward-claim-status" class="status-message" aria-live="polite"></p>
    </div>
  `;

  const btn      = container.querySelector('#claim-reward-btn');
  const statusEl = container.querySelector('#reward-claim-status');

  function setLocalStatus(msg, tone = 'muted') {
    if (!statusEl) return;
    statusEl.textContent  = msg || '';
    statusEl.dataset.tone = tone;
  }

  if (!canClaim) return;

  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    setLocalStatus('Claiming daily reward…');

    try {
      const result = await apiClient.claimDailyReward();
      const amount = result?.reward_amount;
      setLocalStatus(
        `Daily reward claimed: ${formatCurrency(amount)}!`,
        'success'
      );
      setStatus?.(`Daily reward: ${formatCurrency(amount)} credited to your reward balance.`, 'success');
      btn.textContent = 'Claimed!';
      await onClaimed?.();
    } catch (error) {
      setLocalStatus(error.message || 'Unable to claim reward.', 'danger');
      btn.disabled = false;
    }
  });
}
