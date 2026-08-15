export function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

// Package allocation is admin-only. Clients view their assigned packages here.
export function renderPackageManager({ container, packages, userPackages }) {
  if (!container) return;

  if (!userPackages.length) {
    container.innerHTML = `
      <div class="card">
        <h2>Your packages</h2>
        <p>No packages have been allocated to your account yet. Contact support to get started.</p>
      </div>
    `;
    return;
  }

  const activeIds = new Set(
    userPackages.filter((up) => up.status === 'active').map((up) => up.package_id)
  );

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2>Your packages</h2>
        <p>Packages are allocated by your account manager.</p>
      </div>
    </div>
    <div class="card-grid">
      ${packages
        .filter((pkg) => activeIds.has(pkg.id))
        .map((pkg) => {
          const profitPerCycle = Number(pkg.amount) * 0.125;
          return `
            <article class="card">
              <h3>${pkg.name}</h3>
              <p class="metric-value">${formatCurrency(pkg.amount)}</p>
              <ul class="list compact">
                <li>Cycle 1: ${formatCurrency(Number(pkg.amount) * 0.5)}</li>
                <li>Cycle 2: ${formatCurrency(Number(pkg.amount) * 0.5)}</li>
                <li>Cycles 3–6: ${formatCurrency(profitPerCycle)} each</li>
                <li>Total return: ${formatCurrency(Number(pkg.amount) * 1.5)}</li>
              </ul>
              <span class="badge active">Active</span>
            </article>
          `;
        }).join('') || '<p>All packages are currently inactive.</p>'}
    </div>
  `;
}
