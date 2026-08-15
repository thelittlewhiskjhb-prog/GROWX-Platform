import { apiClient } from './api-client.js';
import { GROWX_TERMS } from '../components/terms-modal.js';

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function calculateFee(amount) {
  const grossAmount = Number(amount || 0);
  const feeAmount = Number((grossAmount * 0.1).toFixed(2));
  return {
    grossAmount,
    feeAmount,
    netAmount: Number((grossAmount - feeAmount).toFixed(2))
  };
}

export function renderWithdrawalManager({ container, profile, withdrawals, setStatus, onSubmitted }) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2>Withdrawals</h2>
        <p>A 10% processing fee is deducted before approval and payout.</p>
      </div>
      <terms-modal label="Withdrawal clauses"></terms-modal>
    </div>
    <div class="split two">
      <article class="card stack gap-sm">
        <p><strong>Available wallet balance</strong></p>
        <p class="metric-value">${formatCurrency(profile.wallet_balance)}</p>
        <form id="withdrawal-form" class="stack gap-sm">
          <label>
            <span>Withdrawal amount (USD)</span>
            <input id="withdrawal-amount" type="number" min="1" step="0.01" required />
          </label>
          <div class="terms-inline subtle">
            <ul>
              ${GROWX_TERMS.slice(0, 1).concat(GROWX_TERMS.slice(5)).map((term) => `<li>${term}</li>`).join('')}
            </ul>
          </div>
          <div id="withdrawal-preview" class="info-box">Fee preview will appear here.</div>
          <button type="submit" class="primary-button">Submit withdrawal request</button>
        </form>
      </article>
      <article class="card">
        <h3>Withdrawal history</h3>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Gross</th>
                <th>Fee</th>
                <th>Net</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${withdrawals.length ? withdrawals.map((item) => `
                <tr>
                  <td>${formatDate(item.requested_at)}</td>
                  <td>${formatCurrency(item.gross_amount)}</td>
                  <td>${formatCurrency(item.fee_amount)}</td>
                  <td>${formatCurrency(item.net_amount)}</td>
                  <td>${item.status}</td>
                </tr>
              `).join('') : '<tr><td colspan="5">No withdrawals submitted yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  `;

  const form = container.querySelector('#withdrawal-form');
  const amountInput = container.querySelector('#withdrawal-amount');
  const preview = container.querySelector('#withdrawal-preview');

  const updatePreview = () => {
    const { grossAmount, feeAmount, netAmount } = calculateFee(amountInput?.value);
    preview.textContent = grossAmount > 0
      ? `You will request ${formatCurrency(grossAmount)}. Fee: ${formatCurrency(feeAmount)}. Net payout after fee: ${formatCurrency(netAmount)}.`
      : 'Fee preview will appear here.';
  };

  amountInput?.addEventListener('input', updatePreview);
  updatePreview();

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(amountInput?.value || 0);

    if (amount <= 0) {
      setStatus('Enter a valid withdrawal amount.', 'warning');
      return;
    }

    setStatus('Submitting withdrawal request…');

    try {
      await apiClient.requestWithdrawal(amount);
      form.reset();
      updatePreview();
      setStatus('Withdrawal submitted successfully.', 'success');
      await onSubmitted?.();
    } catch (error) {
      setStatus(error.message || 'Unable to submit withdrawal request.', 'danger');
    }
  });
}
