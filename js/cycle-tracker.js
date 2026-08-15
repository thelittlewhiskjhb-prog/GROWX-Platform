function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function getPendingCycles(userPackage) {
  return (userPackage.cycles || []).filter((cycle) => cycle.status === 'pending');
}

export function getNextPayout(userPackages) {
  const pendingCycles = userPackages
    .flatMap((item) => getPendingCycles(item).map((cycle) => ({ ...cycle, packageName: item.packages?.name })))
    .sort((left, right) => new Date(left.payout_date) - new Date(right.payout_date));

  return pendingCycles[0] || null;
}

export function renderCycleTracker(container, userPackages) {
  if (!container) return;

  if (!userPackages.length) {
    container.innerHTML = '<div class="card"><p>No active or completed packages yet.</p></div>';
    return;
  }

  container.innerHTML = userPackages.map((userPackage) => {
    const paidCycles = (userPackage.cycles || []).filter((cycle) => cycle.status === 'paid').length;
    const nextCycle = getPendingCycles(userPackage).sort((left, right) => new Date(left.payout_date) - new Date(right.payout_date))[0];

    return `
      <article class="card stack gap-sm">
        <div class="section-header">
          <div>
            <h3>${userPackage.packages?.name || 'Package'}</h3>
            <p>${formatCurrency(userPackage.principal_amount)} principal · ${userPackage.status}</p>
          </div>
          <span class="badge ${userPackage.status}">${userPackage.status}</span>
        </div>
        <cycle-progress completed-cycles="${paidCycles}" total-cycles="6"></cycle-progress>
        <div class="split two">
          <div>
            <strong>Next payout</strong>
            <p>${nextCycle ? `${formatCurrency(nextCycle.payout_amount)} on ${formatDate(nextCycle.payout_date)}` : 'Completed'}</p>
          </div>
          <div>
            <strong>Total expected return</strong>
            <p>${formatCurrency(userPackage.total_expected_return)}</p>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Type</th>
                <th>Payout date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${(userPackage.cycles || []).sort((left, right) => left.cycle_number - right.cycle_number).map((cycle) => `
                <tr>
                  <td>${cycle.cycle_number}</td>
                  <td>${cycle.payout_type.replace('_', ' ')}</td>
                  <td>${formatDate(cycle.payout_date)}</td>
                  <td>${formatCurrency(cycle.payout_amount)}</td>
                  <td>${cycle.status}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }).join('');
}
