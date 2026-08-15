function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

function buildDetailModal(entry) {
  const networkLabel = entry.network_type ? entry.network_type.toUpperCase() : '—';
  const walletAddress = entry.wallet_address || '—';
  const canApprove = entry.status === 'pending';
  const canMarkDone = entry.status === 'approved';

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
          <dt>Status</dt>
          <dd>${entry.status}</dd>
          <dt>Network</dt>
          <dd>${networkLabel}</dd>
          <dt>Wallet address</dt>
          <dd class="wallet-address">${walletAddress}</dd>
        </dl>
        <div class="button-row">
          <button class="secondary-button" data-modal-approve="${entry.id}" ${canApprove ? '' : 'disabled'}>Approve</button>
          <button class="danger-button" data-modal-reject="${entry.id}" ${canApprove ? '' : 'disabled'}>Reject</button>
          <button class="primary-button" data-modal-done="${entry.id}" ${canMarkDone ? '' : 'disabled'}>Done</button>
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
            ${withdrawals.length ? withdrawals.map((entry) => {
              const canApprove = entry.status === 'pending';
              const canMarkDone = entry.status === 'approved';
              return `
                <tr>
                  <td>
                    <button class="link-button" data-view="${entry.id}" type="button">
                      ${entry.users?.full_name || '—'}
                    </button>
                  </td>
                  <td>${new Date(entry.requested_at).toLocaleString()}</td>
                  <td>${formatCurrency(entry.gross_amount)}</td>
                  <td>${formatCurrency(entry.fee_amount)}</td>
                  <td>${formatCurrency(entry.net_amount)}</td>
                  <td>${entry.network_type ? entry.network_type.toUpperCase() : '—'}</td>
                  <td>${entry.status}</td>
                  <td>
                    <div class="button-row">
                      <button class="secondary-button" data-approve="${entry.id}" ${canApprove ? '' : 'disabled'}>Approve</button>
                      <button class="danger-button" data-reject="${entry.id}" ${canApprove ? '' : 'disabled'}>Reject</button>
                      <button class="primary-button" data-done="${entry.id}" ${canMarkDone ? '' : 'disabled'}>Done</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="8">No withdrawals found.</td></tr>'}
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

    modalRoot.querySelector(`[data-modal-approve="${withdrawalId}"]`)?.addEventListener('click', async () => {
      modalRoot.innerHTML = '';
      await handlers.onReview(withdrawalId, 'approved');
    });

    modalRoot.querySelector(`[data-modal-reject="${withdrawalId}"]`)?.addEventListener('click', async () => {
      modalRoot.innerHTML = '';
      await handlers.onReview(withdrawalId, 'rejected');
    });

    modalRoot.querySelector(`[data-modal-done="${withdrawalId}"]`)?.addEventListener('click', async () => {
      modalRoot.innerHTML = '';
      await handlers.onReview(withdrawalId, 'paid');
    });
  }

  container.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => openModal(button.dataset.view));
  });

  container.querySelectorAll('[data-approve]').forEach((button) => {
    button.addEventListener('click', () => handlers.onReview(button.dataset.approve, 'approved'));
  });
  container.querySelectorAll('[data-reject]').forEach((button) => {
    button.addEventListener('click', () => handlers.onReview(button.dataset.reject, 'rejected'));
  });
  container.querySelectorAll('[data-done]').forEach((button) => {
    button.addEventListener('click', () => handlers.onReview(button.dataset.done, 'paid'));
  });
}

