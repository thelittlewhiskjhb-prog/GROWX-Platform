import { apiClient } from './api-client.js';

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

const NETWORK_LABELS = { trc20: 'TRC20 (Tron)', erc20: 'ERC20 (Ethereum)' };

export function renderRechargeManager({ container, recharges, setStatus, onSubmitted }) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2>Recharge — USDT deposit</h2>
        <p>Select a network, copy the deposit address, send USDT externally, then submit a deposit request so our team can verify your payment.</p>
      </div>
    </div>
    <div class="split two">
      <article class="card stack gap-sm">
        <h3>Make a deposit</h3>
        <p class="warning-box">⚠️ Send USDT using the selected network only. Sending through another network may result in permanent loss of funds.</p>

        <fieldset class="stack gap-xs">
          <legend>Select network</legend>
          <label class="inline-radio">
            <input type="radio" name="recharge_network" value="trc20" id="rn-trc20" /> TRC20 (Tron)
          </label>
          <label class="inline-radio">
            <input type="radio" name="recharge_network" value="erc20" id="rn-erc20" /> ERC20 (Ethereum)
          </label>
        </fieldset>

        <div id="deposit-address-display" class="address-row" hidden>
          <span class="address-label" id="deposit-network-label"></span>
          <span class="address-value" id="deposit-address-text">Loading…</span>
          <button type="button" class="copy-button secondary-button" id="copy-deposit-address">Copy</button>
        </div>

        <form id="recharge-form" class="stack gap-sm" hidden>
          <label>
            <span>Amount you are sending (USDT)</span>
            <input id="recharge-amount" type="number" min="1" step="0.01" required />
          </label>
          <p class="muted-text">After sending, submit this request so our team can verify and credit your balance. Do not click submit before sending.</p>
          <button type="submit" class="primary-button" id="recharge-submit-btn">Submit deposit request</button>
        </form>
      </article>

      <article class="card">
        <h3>Deposit history</h3>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Network</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${recharges.length ? recharges.map((item) => `
                <tr>
                  <td>${formatDate(item.created_at)}</td>
                  <td>${formatCurrency(item.amount)} USDT</td>
                  <td>${NETWORK_LABELS[item.network] || item.network}</td>
                  <td><span class="badge ${item.status}">${item.status}</span></td>
                </tr>
              `).join('') : '<tr><td colspan="4">No deposit requests yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  `;

  let depositAddresses = {};
  let selectedNetwork = null;

  // Load deposit addresses from DB
  apiClient.fetchDepositAddresses().then((rows) => {
    rows.forEach((row) => { depositAddresses[row.network] = row.address; });
  }).catch(() => {});

  const addressDisplay  = container.querySelector('#deposit-address-display');
  const networkLabel    = container.querySelector('#deposit-network-label');
  const addressText     = container.querySelector('#deposit-address-text');
  const copyBtn         = container.querySelector('#copy-deposit-address');
  const rechargeForm    = container.querySelector('#recharge-form');
  const submitBtn       = container.querySelector('#recharge-submit-btn');

  container.querySelectorAll('input[name="recharge_network"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      selectedNetwork = radio.value;
      const address = depositAddresses[selectedNetwork];
      networkLabel.textContent = NETWORK_LABELS[selectedNetwork] || selectedNetwork;
      addressText.textContent  = address || 'Address not configured — contact support.';
      addressDisplay.hidden    = false;
      rechargeForm.hidden      = !address;
    });
  });

  copyBtn?.addEventListener('click', async () => {
    const text = addressText?.textContent?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 2000);
    } catch {
      copyBtn.textContent = 'Failed';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    }
  });

  rechargeForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(container.querySelector('#recharge-amount')?.value || 0);

    if (!amount || amount <= 0) {
      setStatus('Enter a valid deposit amount.', 'warning');
      return;
    }

    if (!selectedNetwork) {
      setStatus('Select a network.', 'warning');
      return;
    }

    submitBtn.disabled = true;
    setStatus('Submitting deposit request…');

    try {
      await apiClient.createRechargeRequest({ amount, network: selectedNetwork });
      rechargeForm.reset();
      addressDisplay.hidden = true;
      rechargeForm.hidden   = true;
      selectedNetwork = null;
      container.querySelectorAll('input[name="recharge_network"]').forEach((r) => { r.checked = false; });
      setStatus('Deposit request submitted. Our team will verify and credit your balance shortly.', 'success');
      await onSubmitted?.();
    } catch (error) {
      setStatus(error.message || 'Unable to submit deposit request.', 'danger');
    } finally {
      submitBtn.disabled = false;
    }
  });
}
