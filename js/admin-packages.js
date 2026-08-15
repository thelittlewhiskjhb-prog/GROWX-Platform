function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

export function renderAdminPackages(container, userPackages) {
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <h2>Package monitoring</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Package</th>
              <th>Principal</th>
              <th>Paid cycles</th>
              <th>Next payout</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${userPackages.length ? userPackages.map((entry) => {
              const paidCycles = (entry.cycles || []).filter((cycle) => cycle.status === 'paid').length;
              const nextCycle = (entry.cycles || [])
                .filter((cycle) => cycle.status === 'pending')
                .sort((left, right) => new Date(left.payout_date) - new Date(right.payout_date))[0];

              return `
                <tr>
                  <td>${entry.users?.full_name || '—'}</td>
                  <td>${entry.packages?.name || '—'}</td>
                  <td>${formatCurrency(entry.principal_amount)}</td>
                  <td>${paidCycles}/6</td>
                  <td>${nextCycle ? `${formatCurrency(nextCycle.payout_amount)} · ${new Date(nextCycle.payout_date).toLocaleDateString()}` : 'Completed'}</td>
                  <td>${entry.status}</td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="6">No package activity found.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
