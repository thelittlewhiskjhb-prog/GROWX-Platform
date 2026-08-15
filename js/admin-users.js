function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

function buildUserModal(user, handlers) {
  const isActive = user.status === 'active';
  const toggleLabel = isActive ? 'Suspend account' : 'Activate account';
  const toggleClass = isActive ? 'danger-button' : 'secondary-button';

  return `
    <div class="modal-backdrop" id="user-modal">
      <article class="card modal-card stack gap-sm" role="dialog" aria-modal="true" aria-label="Client management">
        <header class="modal-header">
          <h3>Manage client</h3>
          <button class="ghost-button" id="user-modal-close" type="button" aria-label="Close">✕</button>
        </header>
        <dl class="detail-list">
          <dt>Name</dt><dd>${user.full_name || '—'}</dd>
          <dt>Phone</dt><dd>${user.phone || '—'}</dd>
          <dt>Email</dt><dd>${user.email || '—'}</dd>
          <dt>Role</dt><dd>${user.role}</dd>
          <dt>Status</dt><dd>${user.status}</dd>
          <dt>Wallet</dt><dd>${formatCurrency(user.wallet_balance)}</dd>
          <dt>Rewards</dt><dd>${formatCurrency(user.reward_balance)}</dd>
        </dl>

        <hr />

        <section class="stack gap-sm">
          <h4>Transfer funds to wallet</h4>
          <form id="fund-transfer-form" class="stack gap-sm">
            <label><span>Amount (USD)</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label><span>Description</span><input name="description" type="text" placeholder="Admin credit" /></label>
            <p class="status-message" data-tone="danger" aria-live="polite" hidden></p>
            <button type="submit" class="primary-button">Transfer funds</button>
          </form>
        </section>

        <hr />

        <div class="button-row">
          <button class="${toggleClass}" id="user-toggle-status" type="button" data-user-id="${user.id}" data-current-status="${user.status}">${toggleLabel}</button>
          ${user.email ? `<button class="ghost-button" id="user-reset-password" type="button" data-email="${user.email}">Send password reset</button>` : '<span class="muted-text">No email — password reset unavailable</span>'}
        </div>
      </article>
    </div>
  `;
}

export function renderAdminUsers(container, users, handlers) {
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <div class="section-header">
        <div>
          <h2>Users</h2>
          <p>Live client and admin account list with balances and status.</p>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Role</th>
              <th>Status</th>
              <th>Wallet</th>
              <th>Rewards</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${users.length ? users.map((user) => `
              <tr>
                <td>${user.full_name || '—'}</td>
                <td>${user.phone || '—'}</td>
                <td>${user.role}</td>
                <td>${user.status}</td>
                <td>${formatCurrency(user.wallet_balance)}</td>
                <td>${formatCurrency(user.reward_balance)}</td>
                <td>
                  <button class="secondary-button user-manage-btn" data-user-id="${user.id}" type="button">Manage</button>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="7">No users found.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div id="user-modal-root"></div>
  `;

  const modalRoot = container.querySelector('#user-modal-root');

  function openUserModal(userId) {
    const user = users.find((u) => u.id === userId);
    if (!user || !modalRoot) return;
    modalRoot.innerHTML = buildUserModal(user, handlers);

    modalRoot.querySelector('#user-modal-close')?.addEventListener('click', () => {
      modalRoot.innerHTML = '';
    });

    modalRoot.querySelector('#fund-transfer-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const amount = Number(formData.get('amount'));
      if (!amount || amount <= 0) {
        const errorEl = event.currentTarget.querySelector('.status-message');
        if (errorEl) {
          errorEl.textContent = 'Enter a valid amount greater than zero.';
          errorEl.hidden = false;
        }
        return;
      }
      const description = formData.get('description')?.toString().trim();
      modalRoot.innerHTML = '';
      await handlers.onTransferFunds({ userId: user.id, amount, description });
    });

    modalRoot.querySelector('#user-toggle-status')?.addEventListener('click', async () => {
      const isActive = user.status === 'active';
      const newStatus = isActive ? 'suspended' : 'active';
      modalRoot.innerHTML = '';
      await handlers.onToggleStatus({ userId: user.id, newStatus });
    });

    modalRoot.querySelector('#user-reset-password')?.addEventListener('click', async () => {
      const email = user.email;
      modalRoot.innerHTML = '';
      await handlers.onResetPassword(email);
    });
  }

  container.querySelectorAll('.user-manage-btn').forEach((button) => {
    button.addEventListener('click', () => openUserModal(button.dataset.userId));
  });
}
