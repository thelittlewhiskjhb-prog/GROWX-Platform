import { apiClient } from './api-client.js';

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

export function renderGiftManager({ container, setStatus, onRedeemed }) {
  if (!container) return;

  container.innerHTML = `
    <div class="card stack gap-sm">
      <h2>Gift code redemption</h2>
      <p>Enter a valid gift code to credit your wallet balance instantly.</p>
      <form id="gift-form" class="split two" style="align-items:flex-end;">
        <label style="flex:1">
          <span>Gift code</span>
          <input id="gift-code-input" type="text" placeholder="e.g. GROW-XXXX" autocomplete="off" required style="text-transform:uppercase" />
        </label>
        <button type="submit" class="primary-button" id="gift-submit-btn">Redeem</button>
      </form>
      <p id="gift-status" class="status-message" aria-live="polite"></p>
    </div>
  `;

  const form      = container.querySelector('#gift-form');
  const input     = container.querySelector('#gift-code-input');
  const submitBtn = container.querySelector('#gift-submit-btn');
  const statusEl  = container.querySelector('#gift-status');

  function setLocalStatus(msg, tone = 'muted') {
    if (!statusEl) return;
    statusEl.textContent  = msg || '';
    statusEl.dataset.tone = tone;
  }

  input?.addEventListener('input', () => {
    input.value = input.value.toUpperCase();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = input?.value?.trim().toUpperCase();

    if (!code) {
      setLocalStatus('Enter a gift code.', 'warning');
      return;
    }

    submitBtn.disabled = true;
    setLocalStatus('Redeeming gift code…');

    try {
      const result = await apiClient.redeemGiftCode(code);
      input.value = '';
      const amount = result?.reward_amount;
      setLocalStatus(
        amount ? `Gift code redeemed! ${formatCurrency(amount)} has been credited to your wallet.` : 'Gift code redeemed.',
        'success'
      );
      setStatus?.(`Gift code credited: ${formatCurrency(amount)}.`, 'success');
      await onRedeemed?.();
    } catch (error) {
      setLocalStatus(error.message || 'Gift code redemption failed.', 'danger');
    } finally {
      submitBtn.disabled = false;
    }
  });
}
