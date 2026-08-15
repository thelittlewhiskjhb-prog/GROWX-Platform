export class CycleProgress extends HTMLElement {
  static get observedAttributes() {
    return ['completed-cycles', 'total-cycles'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const completedCycles = Number(this.getAttribute('completed-cycles') || 0);
    const totalCycles = Number(this.getAttribute('total-cycles') || 6);
    const bars = Array.from({ length: totalCycles }, (_, index) => {
      const statusClass = index < completedCycles ? 'completed' : 'pending';
      return `<span class="cycle-bar ${statusClass}" aria-hidden="true"></span>`;
    }).join('');

    this.innerHTML = `
      <div class="cycle-progress" aria-label="${completedCycles} of ${totalCycles} cycles completed">
        ${bars}
      </div>
    `;
  }
}

customElements.define('cycle-progress', CycleProgress);
