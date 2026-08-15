import { apiClient } from './api-client.js';
import { GROWX_TERMS } from '../components/terms-modal.js';

export function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

function getActivePackageIds(userPackages) {
  return new Set(
    userPackages
      .filter((item) => item.status === 'active')
      .map((item) => item.package_id)
  );
}

export function renderPackageManager({ container, packages, userPackages, setStatus, onPurchased }) {
  if (!container) return;

  const activePackageIds = getActivePackageIds(userPackages);

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2>Package purchase</h2>
        <p>Packages pay back principal in cycles 1-2 and profit in cycles 3-6.</p>
      </div>
      <terms-modal label="Package clauses"></terms-modal>
    </div>
    <div class="terms-inline">
      <ul>
        ${GROWX_TERMS.slice(0, 5).map((term) => `<li>${term}</li>`).join('')}
      </ul>
    </div>
    <div class="card-grid">
      ${packages.map((pkg) => {
        const disabled = activePackageIds.has(pkg.id);
        const profitPerCycle = Number(pkg.amount) * 0.125;
        return `
          <article class="card">
            <h3>${pkg.name}</h3>
            <p class="metric-value">${formatCurrency(pkg.amount)}</p>
            <ul class="list compact">
              <li>Cycle 1: ${formatCurrency(Number(pkg.amount) * 0.5)}</li>
              <li>Cycle 2: ${formatCurrency(Number(pkg.amount) * 0.5)}</li>
              <li>Cycles 3-6: ${formatCurrency(profitPerCycle)} each</li>
              <li>Total return: ${formatCurrency(Number(pkg.amount) * 1.5)}</li>
            </ul>
            <label class="checkbox-row">
              <input type="checkbox" data-agree="${pkg.id}" ${disabled ? 'disabled' : ''} />
              <span>I accept the 6-cycle terms and non-refundable investment clause.</span>
            </label>
            <button class="primary-button" data-purchase="${pkg.id}" ${disabled ? 'disabled' : ''}>
              ${disabled ? 'Active package' : 'Buy package'}
            </button>
          </article>
        `;
      }).join('')}
    </div>
  `;

  container.querySelectorAll('[data-purchase]').forEach((button) => {
    button.addEventListener('click', async () => {
      const packageId = button.dataset.purchase;
      const agreed = container.querySelector(`[data-agree="${packageId}"]`)?.checked;

      if (!agreed) {
        setStatus('You must accept the package clauses before continuing.', 'warning');
        return;
      }

      button.disabled = true;
      setStatus('Creating package purchase…');

      try {
        await apiClient.purchasePackage(packageId);
        setStatus('Package purchased successfully. Your 6-cycle schedule is now active.', 'success');
        await onPurchased?.();
      } catch (error) {
        setStatus(error.message || 'Package purchase failed.', 'danger');
      } finally {
        button.disabled = false;
      }
    });
  });
}
