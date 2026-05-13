/*
 * Composition root — AutoKeep SPA bootstrap.
 *
 * Boot sequence:
 *   1. Render a skip-nav link and the #app root (from index.html).
 *   2. Check workspaces index in localStorage.
 *   3a. No workspaces → show SetupScreen.
 *   3b. Workspaces exist → show UnlockScreen.
 *   4. On successful unlock, wire the main router and load the records view.
 *
 * Constitution Principles I + II: no business logic here; only composition.
 * Principle III: LocalStorageAdapter is the only storage path.
 */

import './styles/reset.css';
import './styles/tokens.css';
import './styles/components.css';

import { LocalStorageAdapter } from './core/storage/local-storage-adapter.js';
import { t } from './core/i18n/index.js';
import { CryptoService, createDefaultKdfWorker } from './core/crypto/crypto-service.js';
// createDefaultKdfWorker returns a KdfWorkerLike; CryptoServiceDeps expects { createKdfWorker }.
import { createRouter } from './core/router/router.js';
import { WorkspaceService } from './modules/workspace/services/workspace-service.js';
import { UnlockThrottle } from './modules/workspace/services/unlock-throttle.js';
import { SetupScreen } from './modules/workspace/ui/setup-screen.js';
import { UnlockScreen } from './modules/workspace/ui/unlock-screen.js';
import type { UnlockedWorkspace } from './modules/workspace/services/workspace-service.js';
import { FilterBar } from './modules/filters/ui/filter-bar.js';
import { ActiveFilters } from './modules/filters/ui/active-filters.js';
import { ResultCount } from './modules/filters/ui/result-count.js';
import { FilterCoordinator } from './modules/filters/services/filter-coordinator.js';
import { emptyFilterState } from './modules/filters/domain/types.js';
import type { FilterState } from './modules/filters/domain/types.js';
import { ImportService } from './modules/import/services/import-service.js';
import { FilePicker } from './modules/import/ui/file-picker.js';
import { ValidationReportView } from './modules/import/ui/validation-report.js';
import { ImportProgress } from './modules/import/ui/import-progress.js';
import { ExportService } from './modules/export/services/export-service.js';
import { ExportDialog } from './modules/export/ui/export-dialog.js';
import { mountDashboard } from './modules/dashboard/index.js';
import { AiService, InconsistenciesView, AiSettingsPanel } from './modules/ai/index.js';

/* ---------- Storage adapter (singleton) ---------- */

const adapter = new LocalStorageAdapter({
  storage: globalThis.localStorage,
  broadcastChannelCtor: globalThis.BroadcastChannel,
});

/* ---------- Workspace service ---------- */

const workspaceService = new WorkspaceService({
  adapter,
  cryptoFactory: () => new CryptoService({ createKdfWorker: createDefaultKdfWorker }),
});

/* ---------- Root element ---------- */

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app element not found');

/* ---------- Boot ---------- */

let currentUnlocked: UnlockedWorkspace | null = null;

const bootRouter = (unlocked: UnlockedWorkspace): void => {
  currentUnlocked = unlocked;
  root.innerHTML = '';

  // Accessibility skeleton: header + nav + main + footer (FR-037)
  const header = document.createElement('header');
  header.setAttribute('role', 'banner');
  const h1 = document.createElement('h1');
  h1.id = 'app-heading';
  h1.textContent = 'AutoKeep';
  h1.style.cssText = 'font-size:1.125rem;margin:0;padding:0.75rem 1rem;';
  header.appendChild(h1);
  root.appendChild(header);

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Navegación principal');
  const navLinks: Array<{ path: string; label: string }> = [
    { path: '/records', label: 'Registros' },
    { path: '/filters', label: 'Filtros' },
    { path: '/import', label: 'Importar' },
    { path: '/export', label: 'Exportar' },
    { path: '/dashboard', label: 'Tablero' },
    { path: '/ai/inconsistencies', label: 'IA' },
    { path: '/settings', label: 'Ajustes' },
  ];
  const navList = document.createElement('ul');
  navList.style.cssText =
    'display:flex;flex-wrap:wrap;gap:0.5rem;list-style:none;margin:0;padding:0.5rem 1rem;border-bottom:1px solid var(--ak-color-border);';
  for (const { path, label } of navLinks) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${path}`;
    a.textContent = label;
    a.style.cssText =
      'padding:0.25rem 0.75rem;text-decoration:none;color:var(--ak-color-link);border-radius:4px;';
    li.appendChild(a);
    navList.appendChild(li);
  }
  nav.appendChild(navList);
  root.appendChild(nav);

  const main = document.createElement('main');
  main.id = 'main-content';
  main.setAttribute('tabindex', '-1');
  root.appendChild(main);

  const footer = document.createElement('footer');
  footer.setAttribute('role', 'contentinfo');
  footer.style.cssText =
    'padding:0.75rem 1rem;font-size:0.875rem;color:var(--ak-color-text-muted);border-top:1px solid var(--ak-color-border);';
  footer.textContent = `AutoKeep — Espacio: ${unlocked.payload.workspace.name}`;
  root.appendChild(footer);

  const router = createRouter(
    [
      {
        pattern: '/records',
        handler: () => {
          main.innerHTML = '';
          main.textContent = `Registros — espacio: ${unlocked.payload.workspace.name}`;
        },
      },
      {
        pattern: '/filters',
        handler: () => {
          main.innerHTML = '';

          // Filter panel host
          const filterHost = document.createElement('section');
          filterHost.className = 'filter-panel';
          main.appendChild(filterHost);

          const chipsHost = document.createElement('div');
          chipsHost.className = 'filter-chips-host';
          main.appendChild(chipsHost);

          const countHost = document.createElement('div');
          countHost.className = 'filter-count-host';
          main.appendChild(countHost);

          let currentState: FilterState = emptyFilterState();

          const coordinator = new FilterCoordinator((_ids, count) => {
            resultCount.update(count, currentState);
            activeFilters.update(currentState);
          });

          const activeFilters = new ActiveFilters(chipsHost, {
            categoryNames: new Map(),
            counterpartyNames: new Map(),
            onRemove: (field) => {
              const s = currentState;
              currentState = {
                query: field === 'query' ? '' : s.query,
                dateFrom: field === 'dateFrom' ? null : s.dateFrom,
                dateTo: field === 'dateTo' ? null : s.dateTo,
                types: field === 'types' ? [] : s.types,
                categoryIds: field === 'categoryIds' ? [] : s.categoryIds,
                counterpartyIds: field === 'counterpartyIds' ? [] : s.counterpartyIds,
                amountMin: field === 'amountMin' ? null : s.amountMin,
                amountMax: field === 'amountMax' ? null : s.amountMax,
              };
              coordinator.setFilter(currentState);
            },
            onClearAll: () => {
              currentState = emptyFilterState();
              coordinator.setFilter(currentState);
              filterBar.reset();
            },
          });

          const resultCount = new ResultCount(countHost);
          resultCount.update(0, currentState);

          const filterBar = new FilterBar(filterHost, {
            categories: [],
            counterparties: [],
            currencyMinorUnits: unlocked.payload.workspace.currencyMinorUnits,
            onChange: (state) => {
              currentState = state;
              coordinator.setFilter(state);
            },
          });

          // Cleanup on navigation away
          const cleanup = (): void => {
            coordinator.dispose();
            main.removeEventListener('destroy', cleanup);
          };
          main.addEventListener('destroy', cleanup);
        },
      },
      {
        pattern: '/import',
        handler: () => {
          main.innerHTML = '';

          const pickerHost = document.createElement('section');
          pickerHost.className = 'import-picker-host';
          main.appendChild(pickerHost);

          const progressHost = document.createElement('div');
          progressHost.className = 'import-progress-host';
          main.appendChild(progressHost);

          const reportHost = document.createElement('div');
          reportHost.className = 'import-report-host';
          main.appendChild(reportHost);

          const progress = new ImportProgress(progressHost);

          // Import service needs a persist callback; stub here until wired
          // fully to the workspace store.
          const importService = new ImportService({
            persistPayload: () => Promise.resolve(),
          });

          let lastReport: import('./modules/import/domain/types.js').ValidationReport | null = null;

          const reportView = new ValidationReportView(reportHost, {
            onCommit: () => {
              progress.showCommitting();
              // Full commit wiring done in integration task; progress shown for now
            },
            onCancel: () => {
              reportHost.innerHTML = '';
            },
          });

          new FilePicker(pickerHost, {
            onSelect: (file) => {
              progress.showValidating();
              importService
                .validate(file, unlocked.payload)
                .then((report) => {
                  lastReport = report;
                  progress.hide();
                  reportView.update(report);
                  return undefined;
                })
                .catch(console.error);
            },
          });

          void lastReport;
        },
      },
      {
        pattern: '/export',
        handler: () => {
          main.innerHTML = '';

          const dialogHost = document.createElement('div');
          dialogHost.className = 'export-dialog-host';
          main.appendChild(dialogHost);

          const exportService = new ExportService();

          const dialog = new ExportDialog(dialogHost, {
            onExport: async (format) => {
              await exportService.export(unlocked.payload, {
                format,
                filterState: emptyFilterState(),
                onEmptyConfirm: async () => {
                  return confirm(t('export.empty.body' as Parameters<typeof t>[0]));
                },
                triggerDownload: (content, filename, mimeType) => {
                  const blob = new Blob([content], { type: mimeType });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = filename;
                  a.style.display = 'none';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                },
              });
            },
            onCancel: () => {
              dialogHost.innerHTML = '';
            },
          });

          dialog.open();
        },
      },
      {
        pattern: '/dashboard',
        handler: () => {
          main.innerHTML = '';
          let disposeDashboard: (() => void) | null = null;

          const render = (): void => {
            if (disposeDashboard) disposeDashboard();
            disposeDashboard = mountDashboard(main, {
              records: unlocked.payload
                .records as import('./modules/records/domain/types.js').FinancialRecord[],
              categories: unlocked.payload
                .categories as import('./modules/records/domain/types.js').Category[],
              counterparties: unlocked.payload
                .counterparties as import('./modules/records/domain/types.js').Counterparty[],
              currencyCode: unlocked.payload.workspace.currency as string,
              currencyMinorUnits: unlocked.payload.workspace.currencyMinorUnits,
            });
          };

          render();

          const cleanup = (): void => {
            if (disposeDashboard) disposeDashboard();
            main.removeEventListener('destroy', cleanup);
          };
          main.addEventListener('destroy', cleanup);
        },
      },
      {
        pattern: '/ai/inconsistencies',
        handler: () => {
          main.innerHTML = '';
          const viewHost = document.createElement('section');
          viewHost.className = 'ai-inconsistencies-host';
          main.appendChild(viewHost);

          const aiService = new AiService({
            settings: { aiEnabled: true },
            persistFindings: () => Promise.resolve(),
          });

          const view = new InconsistenciesView(viewHost, {
            onDismiss: () => {
              // Full wiring deferred to workspace-store integration task
            },
            onEdit: () => {
              router.navigate('/records');
            },
          });

          void aiService
            .runInconsistenciesPass(
              unlocked.payload
                .records as import('./modules/records/domain/types.js').FinancialRecord[],
            )
            .then((findings) => {
              view.update(findings);
              return undefined;
            });
        },
      },
      {
        pattern: '/settings',
        handler: () => {
          main.innerHTML = '';
          const settingsHost = document.createElement('section');
          settingsHost.className = 'ai-settings-host';
          settingsHost.style.cssText = 'padding: 1.5rem;';
          main.appendChild(settingsHost);

          new AiSettingsPanel(settingsHost, {
            initialEnabled: true,
            onToggle: () => {
              // Full persistence wiring deferred to workspace-store integration task
            },
          });
        },
      },
      {
        pattern: '/not-found',
        handler: () => {
          main.textContent = 'Página no encontrada.';
        },
      },
    ],
    { defaultPath: '/records', notFoundPath: '/not-found' },
  );

  // Focus-restore on route change (FR-037 / SC-012)
  window.addEventListener('hashchange', () => {
    const mainEl = document.getElementById('main-content');
    if (mainEl) mainEl.focus();
  });

  router.start();
};

const showSetup = (): void => {
  root.innerHTML = '';
  const screen = new SetupScreen(root, {
    onSubmit: async (input) => {
      const unlocked = await workspaceService.createWorkspace(input);
      bootRouter(unlocked);
    },
  });
  screen.render();
};

const showUnlock = async (): Promise<void> => {
  const workspaces = await workspaceService.listWorkspaces();

  if (workspaces.length === 0) {
    showSetup();
    return;
  }

  root.innerHTML = '';
  const throttle = new UnlockThrottle({
    adapter,
    workspaceId: workspaces[0]?.id ?? 'default',
  });

  const screen = new UnlockScreen(root, {
    onUnlock: async (workspaceId, passphrase) => {
      const unlocked = await workspaceService.unlockWorkspace(workspaceId, passphrase);
      bootRouter(unlocked);
    },
    onCreateNew: showSetup,
  });
  screen.render([...workspaces], throttle);
};

// Lock any existing workspace reference on page visibility change (SC-014).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && currentUnlocked) {
    currentUnlocked.crypto.lock();
  }
});

void showUnlock();
