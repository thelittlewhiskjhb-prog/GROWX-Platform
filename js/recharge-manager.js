import { apiClient } from './api-client.js';

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

const NETWORK_LABELS = { trc20: 'USDT TRC20', erc20: 'USDT ERC20' };

export function renderRechargeManager({ container, recharges, setStatus, onSubmitted }) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2>Recharge — USDT deposit</h2>
        <p>Copy the correct address for your selected network, send USDT externally, then submit a deposit request and payment proof to the designated Telegram admin group.</p>
      </div>
    </div>
    <div class="split two">
      <article class="card stack gap-sm">
        <h3>Make a deposit</h3>
        <p class="warning-box">Send USDT using the selected network only.</p>

        <div class="stack gap-xs">
          <div class="address-row">
            <span class="address-label">USDT ERC20</span>
            <span class="address-value" id="deposit-address-erc20">Loading…</span>
            <button type="button" class="copy-button secondary-button" data-network="erc20">COPY ADDRESS</button>
          </div>
          <div class="address-row">
            <span class="address-label">USDT TRC20</span>
            <span class="address-value" id="deposit-address-trc20">Loading…</span>
            <button type="button" class="copy-button secondary-button" data-network="trc20">COPY ADDRESS</button>
          </div>
        </div>

        <form id="recharge-form" class="stack gap-sm">
          <fieldset class="stack gap-xs">
            <legend>Select the network you used to send</legend>
            <label class="inline-radio">
              <input type="radio" name="recharge_network" value="erc20" required /> USDT ERC20
            </label>
            <label class="inline-radio">
              <input type="radio" name="recharge_network" value="trc20" required /> USDT TRC20
            </label>
          </fieldset>
          <label>
            <span>Amount you are sending (USDT)</span>
            <input id="recharge-amount" type="number" min="1" step="0.01" required />
          </label>
          <p class="muted-text">Do not submit before sending. Your balance is credited only after admin verification.</p>
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
  const form = container.querySelector('#recharge-form');
  const submitBtn = container.querySelector('#recharge-submit-btn');

  const setAddressText = (network, value) => {
    const node = container.querySelector(`#deposit-address-${network}`);
    if (node) {
      node.textContent = value || 'Address not configured — contact support.';
    }
  };

  apiClient.fetchDepositAddresses()
    .then((rows) => {
      rows.forEach((row) => { depositAddresses[row.network] = row.address; });
      setAddressText('erc20', depositAddresses.erc20);
      setAddressText('trc20', depositAddresses.trc20);
    })
    .catch(() => {
      setAddressText('erc20', '');
      setAddressText('trc20', '');
    });

  container.querySelectorAll('.copy-button[data-network]').forEach((button) => {
    button.addEventListener('click', async () => {
      const network = button.getAttribute('data-network');
      const text = (network && depositAddresses[network]) ? depositAddresses[network].trim() : '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'COPIED!';
        button.classList.add('copied');
        setTimeout(() => {
          button.textContent = 'COPY ADDRESS';
          button.classList.remove('copied');
        }, 2000);
      } catch {
        button.textContent = 'FAILED';
        setTimeout(() => { button.textContent = 'COPY ADDRESS'; }, 2000);
      }
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(container.querySelector('#recharge-amount')?.value || 0);
    const selectedNetwork = form.querySelector('input[name="recharge_network"]:checked')?.value;
    const targetAddress = selectedNetwork ? depositAddresses[selectedNetwork] : '';

    if (!amount || amount <= 0) {
      setStatus('Enter a valid deposit amount.', 'warning');
      return;
    }

    if (!selectedNetwork || !targetAddress) {
      setStatus('Select a configured network address first.', 'warning');
      return;
    }

    submitBtn.disabled = true;
    setStatus('Submitting deposit request…');

    try {
      await apiClient.createRechargeRequest({ amount, network: selectedNetwork });
      form.reset();
      setStatus('Deposit request submitted. Share payment proof in the designated Telegram admin group. Balance is credited only after admin verification.', 'success');
      await onSubmitted?.();
    } catch (error) {
      setStatus(error.message || 'Unable to submit deposit request.', 'danger');
    } finally {
      submitBtn.disabled = false;
    }
  });
}
