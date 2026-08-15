function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
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
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${withdrawals.length ? withdrawals.map((entry) => {
              const canApprove = entry.status === 'pending';
              const canMarkPaid = entry.status === 'approved';
              return `
                <tr>
                  <td>${entry.users?.full_name || '—'}</td>
                  <td>${new Date(entry.requested_at).toLocaleString()}</td>
                  <td>${formatCurrency(entry.gross_amount)}</td>
                  <td>${formatCurrency(entry.fee_amount)}</td>
                  <td>${formatCurrency(entry.net_amount)}</td>
                  <td>${entry.status}</td>
                  <td>
                    <div class="button-row">
                      <button class="secondary-button" data-approve="${entry.id}" ${canApprove ? '' : 'disabled'}>Approve</button>
                      <button class="danger-button" data-reject="${entry.id}" ${canApprove ? '' : 'disabled'}>Reject</button>
                      <button class="primary-button" data-paid="${entry.id}" ${canMarkPaid ? '' : 'disabled'}>Mark paid</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="7">No withdrawals found.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-approve]').forEach((button) => {
    button.addEventListener('click', () => handlers.onReview(button.dataset.approve, 'approved'));
  });
  container.querySelectorAll('[data-reject]').forEach((button) => {
    button.addEventListener('click', () => handlers.onReview(button.dataset.reject, 'rejected'));
  });
  container.querySelectorAll('[data-paid]').forEach((button) => {
    button.addEventListener('click', () => handlers.onReview(button.dataset.paid, 'paid'));
  });
}
