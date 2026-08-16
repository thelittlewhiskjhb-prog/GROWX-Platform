function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

const NETWORK_LABELS = { trc20: 'TRC20 (Tron)', erc20: 'ERC20 (Ethereum)' };

function buildDetailModal(entry) {
  const networkLabel = entry.network ? NETWORK_LABELS[entry.network] || entry.network.toUpperCase() : '—';
  const walletAddress = entry.wallet_address || '—';

  const canApprove  = entry.status === 'processing';
  const canReject   = entry.status === 'processing' || entry.status === 'approved';
  const canComplete = entry.status === 'approved';

  return `
    <div class="modal-backdrop" id="withdrawal-modal">
      <article class="card modal-card stack gap-sm" role="dialog" aria-modal="true" aria-label="Withdrawal detail">
        <header class="modal-header">
          <h3>Withdrawal request</h3>
          <button class="ghost-button" id="modal-close-button" type="button" aria-label="Close">✕</button>
        </header>
        <dl class="detail-list">
          <dt>Client</dt>
          <dd>${entry.users?.full_name || '—'}</dd>
          <dt>Client code</dt>
          <dd>${entry.users?.client_code || '—'}</dd>
          <dt>Phone</dt>
          <dd>${entry.users?.phone || '—'}</dd>
          <dt>Requested</dt>
          <dd>${new Date(entry.requested_at).toLocaleString()}</dd>
          <dt>Gross amount</dt>
          <dd>${formatCurrency(entry.gross_amount)}</dd>
          <dt>Fee (10%)</dt>
          <dd>${formatCurrency(entry.fee_amount)}</dd>
          <dt>Net payout</dt>
          <dd><strong>${formatCurrency(entry.net_amount)}</strong></dd>
          <dt>Network</dt>
          <dd>${networkLabel}</dd>
          <dt>USDT address</dt>
          <dd class="wallet-address">${walletAddress}</dd>
          <dt>Status</dt>
          <dd>${entry.status}</dd>
          ${entry.admin_notes ? `<dt>Admin notes</dt><dd>${entry.admin_notes}</dd>` : ''}
          ${entry.admin_transaction_hash ? `<dt>Transaction hash</dt><dd class="wallet-address">${entry.admin_transaction_hash}</dd>` : ''}
          ${entry.processed_at ? `<dt>Processed</dt><dd>${new Date(entry.processed_at).toLocaleString()}</dd>` : ''}
        </dl>

        <label>
          <span>Admin notes (optional)</span>
          <input id="modal-notes" type="text" placeholder="Notes for audit record" value="${entry.admin_notes || ''}" />
        </label>

        ${canComplete ? `
          <label>
            <span>Blockchain transaction hash</span>
            <input id="modal-tx-hash" type="text" placeholder="Paste transaction hash" />
          </label>
        ` : ''}

        <div class="button-row">
          <button class="secondary-button" data-modal-approve="${entry.id}" ${canApprove ? '' : 'disabled'}>Approve</button>
          <button class="danger-button" data-modal-reject="${entry.id}" ${canReject ? '' : 'disabled'}>Reject</button>
          <button class="primary-button" data-modal-done="${entry.id}" ${canComplete ? '' : 'disabled'}>Mark completed</button>
        </div>
      </article>
    </div>
  `;
}

export function renderAdminWithdrawals(container, withdrawals, handlers) {
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <h2>Withdrawal approval queue</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Code</th>
              <th>Requested</th>
              <th>Gross</th>
              <th>Fee</th>
              <th>Net</th>
              <th>Network</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${withdrawals.length ? withdrawals.map((entry) => `
              <tr>
                <td>
                  <button class="link-button" data-view="${entry.id}" type="button">
                    ${entry.users?.full_name || '—'}
                  </button>
                </td>
                <td>${entry.users?.client_code || '—'}</td>
                <td>${new Date(entry.requested_at).toLocaleString()}</td>
                <td>${formatCurrency(entry.gross_amount)}</td>
                <td>${formatCurrency(entry.fee_amount)}</td>
                <td>${formatCurrency(entry.net_amount)}</td>
                <td>${entry.network ? NETWORK_LABELS[entry.network] || entry.network.toUpperCase() : '—'}</td>
                <td><span class="badge ${entry.status}">${entry.status}</span></td>
                <td>
                  <button class="secondary-button" data-view="${entry.id}" type="button">View</button>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="9">No withdrawals found.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div id="withdrawal-modal-root"></div>
  `;

  const modalRoot = container.querySelector('#withdrawal-modal-root');

  function openModal(withdrawalId) {
    const entry = withdrawals.find((w) => w.id === withdrawalId);
    if (!entry || !modalRoot) return;
    modalRoot.innerHTML = buildDetailModal(entry);

    modalRoot.querySelector('#modal-close-button')?.addEventListener('click', () => {
      modalRoot.innerHTML = '';
    });

    const getNotes = () => modalRoot.querySelector('#modal-notes')?.value?.trim() || null;
    const getTxHash = () => modalRoot.querySelector('#modal-tx-hash')?.value?.trim() || null;

    modalRoot.querySelector(`[data-modal-approve="${withdrawalId}"]`)?.addEventListener('click', async () => {
      modalRoot.innerHTML = '';
      await handlers.onReview(withdrawalId, 'approved', getNotes(), null);
    });

    modalRoot.querySelector(`[data-modal-reject="${withdrawalId}"]`)?.addEventListener('click', async () => {
      modalRoot.innerHTML = '';
      await handlers.onReview(withdrawalId, 'rejected', getNotes(), null);
    });

    modalRoot.querySelector(`[data-modal-done="${withdrawalId}"]`)?.addEventListener('click', async () => {
      const txHash = getTxHash();
      modalRoot.innerHTML = '';
      await handlers.onReview(withdrawalId, 'completed', getNotes(), txHash);
    });
  }

  container.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => openModal(button.dataset.view));
  });
}
