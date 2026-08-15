export class PinLogin extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready === 'true') {
      return;
    }

    this.dataset.ready = 'true';
    this.innerHTML = `
      <div class="pin-card">
        <div>
          <h2>Enter your 4-digit PIN</h2>
          <p>Use the PIN saved on your GROWX profile to unlock the client dashboard.</p>
        </div>
        <form id="pin-form" class="stack gap-sm">
          <input id="pin-input" name="pin" inputmode="numeric" maxlength="4" minlength="4" pattern="\\d{4}" placeholder="••••" class="pin-input" required />
          <button type="submit" class="primary-button">Unlock dashboard</button>
        </form>
        <p class="status-message" id="pin-status"></p>
      </div>
    `;

    this.querySelector('#pin-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const pin = this.querySelector('#pin-input')?.value?.trim();

      this.dispatchEvent(new CustomEvent('pin-submit', {
        bubbles: true,
        detail: { pin }
      }));
    });
  }

  setStatus(message, tone = 'muted') {
    const status = this.querySelector('#pin-status');
    if (!status) return;
    status.textContent = message || '';
    status.dataset.tone = tone;
  }
}

customElements.define('pin-login', PinLogin);
