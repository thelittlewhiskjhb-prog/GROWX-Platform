function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

export function renderAdminUsers(container, users) {
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
              </tr>
            `).join('') : '<tr><td colspan="6">No users found.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
