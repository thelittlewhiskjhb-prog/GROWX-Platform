function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

const NETWORK_LABELS = { trc20: 'TRC20 (Tron)', erc20: 'ERC20 (Ethereum)' };

export function renderAdminRecharges(container, recharges, handlers) {
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <h2>Deposit verification queue</h2>
      <p class="muted-text">Verify client deposit requests after confirming on-chain receipt. Verification credits the client balance.</p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Code</th>
              <th>Submitted</th>
              <th>Amount</th>
              <th>Network</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${recharges.length ? recharges.map((r) => {
              const isPending = r.status === 'pending';
              return `
                <tr>
                  <td>${r.users?.full_name || '—'}</td>
                  <td>${r.users?.client_code || '—'}</td>
                  <td>${formatDate(r.created_at)}</td>
                  <td>${formatCurrency(r.amount)} USDT</td>
                  <td>${NETWORK_LABELS[r.network] || r.network}</td>
                  <td><span class="badge ${r.status}">${r.status}</span></td>
                  <td>
                    <div class="button-row">
                      <button class="secondary-button recharge-verify-btn" data-id="${r.id}" ${isPending ? '' : 'disabled'}>Verify</button>
                      <button class="danger-button recharge-reject-btn" data-id="${r.id}" ${isPending ? '' : 'disabled'}>Reject</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="7">No deposit requests found.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div id="recharge-notes-modal-root"></div>
  `;

  const modalRoot = container.querySelector('#recharge-notes-modal-root');

  function openNotesModal(rechargeId, action) {
    modalRoot.innerHTML = `
      <div class="modal-backdrop" id="recharge-modal">
        <article class="card modal-card stack gap-sm" role="dialog" aria-modal="true">
          <header class="modal-header">
            <h3>${action === 'verify' ? 'Verify deposit' : 'Reject deposit'}</h3>
            <button class="ghost-button" id="recharge-modal-close" type="button">✕</button>
          </header>
          <label>
            <span>Admin notes (optional)</span>
            <input id="recharge-admin-notes" type="text" placeholder="Notes for audit record" />
          </label>
          <div class="button-row">
            <button id="recharge-confirm-btn" class="${action === 'verify' ? 'primary-button' : 'danger-button'}" type="button">
              ${action === 'verify' ? 'Confirm verification' : 'Confirm rejection'}
            </button>
          </div>
        </article>
      </div>
    `;

    modalRoot.querySelector('#recharge-modal-close')?.addEventListener('click', () => {
      modalRoot.innerHTML = '';
    });

    modalRoot.querySelector('#recharge-confirm-btn')?.addEventListener('click', async () => {
      const notes = modalRoot.querySelector('#recharge-admin-notes')?.value?.trim();
      modalRoot.innerHTML = '';
      await handlers.onVerifyRecharge({ rechargeId, action, adminNotes: notes });
    });
  }

  container.querySelectorAll('.recharge-verify-btn').forEach((btn) => {
    btn.addEventListener('click', () => openNotesModal(btn.dataset.id, 'verify'));
  });

  container.querySelectorAll('.recharge-reject-btn').forEach((btn) => {
    btn.addEventListener('click', () => openNotesModal(btn.dataset.id, 'reject'));
  });
}
