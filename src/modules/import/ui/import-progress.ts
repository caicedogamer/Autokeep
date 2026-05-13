/*
 * ImportProgress — shows a spinner / progress bar while the import
 * worker is validating a large file.
 */

export class ImportProgress {
  private readonly host: HTMLElement;

  public constructor(host: HTMLElement) {
    this.host = host;
  }

  public showValidating(): void {
    this.host.innerHTML = '';
    const p = document.createElement('p');
    p.setAttribute('role', 'status');
    p.setAttribute('aria-live', 'polite');
    p.textContent = 'Validando archivo…';
    this.host.appendChild(p);
  }

  public showCommitting(): void {
    const p = this.host.querySelector('[role="status"]');
    if (p) p.textContent = 'Importando registros…';
  }

  public hide(): void {
    this.host.innerHTML = '';
  }
}
