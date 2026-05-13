/*
 * AiSettings toggle — single switch under #/settings (US6).
 * Persists via the provided callback.
 */
import './ai-settings.css';

export interface AiSettingsOpts {
  readonly initialEnabled: boolean;
  readonly onToggle: (enabled: boolean) => void;
}

export class AiSettingsPanel {
  private readonly host: HTMLElement;
  private readonly opts: AiSettingsOpts;

  public constructor(host: HTMLElement, opts: AiSettingsOpts) {
    this.host = host;
    this.opts = opts;
    this.render();
  }

  private render(): void {
    this.host.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'ai-settings';

    const title = document.createElement('h2');
    title.className = 'ai-settings__title';
    title.textContent = 'Asistente de IA';
    panel.appendChild(title);

    const row = document.createElement('div');
    row.className = 'ai-settings__row';

    const labelGroup = document.createElement('div');
    const labelEl = document.createElement('label');
    labelEl.className = 'ai-settings__label';
    labelEl.htmlFor = 'ai-enabled-toggle';
    labelEl.textContent = 'Activar sugerencias y detección de inconsistencias';
    labelGroup.appendChild(labelEl);

    const desc = document.createElement('p');
    desc.className = 'ai-settings__desc';
    desc.textContent =
      'El análisis se realiza localmente; ningún dato financiero sale del dispositivo.';
    labelGroup.appendChild(desc);
    row.appendChild(labelGroup);

    const toggle = document.createElement('label');
    toggle.className = 'ai-settings__toggle';

    const checkbox = document.createElement('input');
    checkbox.id = 'ai-enabled-toggle';
    checkbox.type = 'checkbox';
    checkbox.checked = this.opts.initialEnabled;
    checkbox.setAttribute('role', 'switch');
    checkbox.setAttribute('aria-checked', String(this.opts.initialEnabled));
    checkbox.addEventListener('change', () => {
      checkbox.setAttribute('aria-checked', String(checkbox.checked));
      this.opts.onToggle(checkbox.checked);
    });

    const track = document.createElement('span');
    track.className = 'ai-settings__toggle-track';
    track.setAttribute('aria-hidden', 'true');

    toggle.appendChild(checkbox);
    toggle.appendChild(track);
    row.appendChild(toggle);
    panel.appendChild(row);

    this.host.appendChild(panel);
  }
}
