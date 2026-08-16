import { apiClient } from './api-client.js';

export function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderPackageManager({
  container,
  packages = [],
  userPackages = [],
  walletBalance = 0,
  setStatus,
  onPurchased
}) {
  if (!container) return;

  const activeIds = new Set(
    userPackages
      .filter((up) => up.status === 'active')
      .map((up) => up.package_id)
  );

  const packageCards = packages.map((pkg) => {
    const isActive = activeIds.has(pkg.id);
    const amount = Number(pkg.amount || 0);
    const dailyReward = Number(pkg.daily_reward || amount * 0.10);
    const totalReturn = amount * 1.5;

    return `
      <article class="card package-card ${isActive ? 'package-active' : ''}">
        <h3>${escapeHtml(pkg.name)}</h3>

        <p class="metric-value">${formatCurrency(amount)}</p>

        <ul class="list compact">
          <li>Daily reward: ${formatCurrency(dailyReward)}</li>
          <li>Cycle 1: ${formatCurrency(amount * 0.5)}</li>
          <li>Cycle 2: ${formatCurrency(amount * 0.5)}</li>
          <li>Cycles 3–6: ${formatCurrency(amount * 0.125)} each</li>
          <li>Total return: ${formatCurrency(totalReturn)}</li>
        </ul>

        ${
          isActive
            ? `<span class="badge active">Active</span>
               <p>This package is already active. You can buy it again after its cycle has completed.</p>`
            : `<button
                 type="button"
                 class="primary-button package-buy-button"
                 data-package-id="${escapeHtml(pkg.id)}"
               >
                 Buy Package
               </button>`
        }
      </article>
    `;
  }).join('');

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2>Investment packages</h2>
        <p>Choose a package using your available wallet balance.</p>
      </div>
      <div>
        <strong>Available balance: ${formatCurrency(walletBalance)}</strong>
      </div>
    </div>

    <div class="card-grid">
      ${
        packageCards ||
        '<div class="card"><p>No packages are currently available.</p></div>'
      }
    </div>
  `;

  container.querySelectorAll('.package-buy-button').forEach((button) => {
    button.addEventListener('click', async () => {
      const packageId = button.dataset.packageId;
      if (!packageId) return;

      const pkg = packages.find((item) => String(item.id) === String(packageId));
      if (!pkg) return;

      const amount = Number(pkg.amount || 0);

      if (Number(walletBalance) < amount) {
        setStatus?.(
          `Insufficient balance. You need ${formatCurrency(amount)} to buy ${pkg.name}.`,
          'danger'
        );
        return;
      }

      const confirmed = window.confirm(
        `Buy ${pkg.name} for ${formatCurrency(amount)}?`
      );

      if (!confirmed) return;

      button.disabled = true;
      button.textContent = 'Processing…';
      setStatus?.('Processing your package purchase…');

      try {
        await apiClient.purchasePackage(packageId);

        setStatus?.(
          `${pkg.name} purchased successfully.`,
          'success'
        );

        await onPurchased?.();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Buy Package';

        setStatus?.(
          error?.message || 'Unable to purchase this package.',
          'danger'
        );
      }
    });
  });
    
