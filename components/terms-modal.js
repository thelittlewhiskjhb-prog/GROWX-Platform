export const GROWX_TERMS = [
  'Every package runs for 6 cycles, with each cycle lasting 10 days (60 days total).',
  'Cycles 1 and 2 return the initial investment at 50% of package value per cycle.',
  'Cycles 3 to 6 pay profit at 12.5% of package value per cycle, for a total return of 150%.',
  'A client cannot buy the same package twice while that package is still active.',
  'After all 6 cycles are paid, the client must purchase a new package to continue earning.',
  'All withdrawals are charged a 10% processing fee before funds are released.',
  'Investments are non-refundable once a package purchase is confirmed.'
];

export class TermsModal extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready === 'true') {
      return;
    }

    this.dataset.ready = 'true';
    this.render();
  }

  render() {
    const label = this.getAttribute('label') || 'View terms';
    const title = this.getAttribute('title') || 'GROWX terms and clauses';

    this.innerHTML = `
      <button type="button" class="secondary-button terms-trigger">${label}</button>
      <dialog class="terms-dialog">
        <div class="terms-card">
          <div class="section-header">
            <h3>${title}</h3>
            <button type="button" class="ghost-button close-terms">Close</button>
          </div>
          <ul class="terms-list">
            ${GROWX_TERMS.map((term) => `<li>${term}</li>`).join('')}
          </ul>
        </div>
      </dialog>
    `;

    const dialog = this.querySelector('dialog');
    this.querySelector('.terms-trigger')?.addEventListener('click', () => dialog?.showModal());
    this.querySelector('.close-terms')?.addEventListener('click', () => dialog?.close());
  }
}

customElements.define('terms-modal', TermsModal);
