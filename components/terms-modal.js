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
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'secondary-button terms-trigger';
    trigger.textContent = label;

    const dialog = document.createElement('dialog');
    dialog.className = 'terms-dialog';

    const card = document.createElement('div');
    card.className = 'terms-card';

    const header = document.createElement('div');
    header.className = 'section-header';

    const heading = document.createElement('h3');
    heading.textContent = title;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'ghost-button close-terms';
    closeButton.textContent = 'Close';

    const list = document.createElement('ul');
    list.className = 'terms-list';

    GROWX_TERMS.forEach((term) => {
      const item = document.createElement('li');
      item.textContent = term;
      list.append(item);
    });

    header.append(heading, closeButton);
    card.append(header, list);
    dialog.append(card);
    this.replaceChildren(trigger, dialog);

    trigger.addEventListener('click', () => dialog.showModal());
    closeButton.addEventListener('click', () => dialog.close());
  }
}

customElements.define('terms-modal', TermsModal);
