/*
 * Composition root — AutoKeep SPA bootstrap.
 *
 * Boot sequence:
 *   1. Theme service applies the persisted [data-theme] (already pre-set
 *      by the anti-flash script in index.html).
 *   2. Check workspaces index in localStorage (via StorageAdapter).
 *   3a. No workspaces → mount SetupScreen.
 *   3b. Workspaces exist → mount UnlockScreen.
 *   4. On successful unlock, build the app shell (sidebar + topbar +
 *      content) and start the hash router.
 *
 * Constitution Principles I + II: no business logic here; only
 * composition. Principle III: LocalStorageAdapter is the only storage
 * path for financial data — `core/theme/` is the documented exception
 * (research.md R18) for the non-secret visual theme.
 */

import './styles/reset.css';
import './styles/tokens.css';
import './styles/components.css';
import './styles/shell.css';

import { LocalStorageAdapter } from './core/storage/local-storage-adapter.js';
import { t } from './core/i18n/index.js';
import { createThemeService } from './core/theme/index.js';
import { CryptoService, createDefaultKdfWorker } from './core/crypto/crypto-service.js';
import { createRouter } from './core/router/router.js';
import { WorkspaceService } from './modules/workspace/services/workspace-service.js';
import { UnlockThrottle } from './modules/workspace/services/unlock-throttle.js';
import { SetupScreen } from './modules/workspace/ui/setup-screen.js';
import { UnlockScreen } from './modules/workspace/ui/unlock-screen.js';
import { ThemeToggle } from './modules/workspace/ui/theme-toggle.js';
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

/* ---------- Theme service (singleton, started before anything else) ---------- */

const themeService = createThemeService();

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

/* ---------- Sidebar / topbar icons (inline SVG, 18×18, currentColor) ---------- */

const ICON = {
  dashboard:
    '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 3h5v6H3V3zm0 8h5v4H3v-4zm7 0h5v4h-5v-4zm0-8h5v6h-5V3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  records:
    '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 4.5h12M3 9h12M3 13.5h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  filters:
    '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 4h12l-4.6 5.2v4.3l-2.8 1.2V9.2L3 4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  import:
    '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 2v9m0 0l-3-3m3 3l3-3M3 13v2h12v-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  export:
    '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 11V2m0 0l-3 3m3-3l3 3M3 13v2h12v-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ai: '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 2.5l1.4 3 3 1.4-3 1.4L9 11.4l-1.4-3-3-1.4 3-1.4L9 2.5zM13.5 12l.8 1.7L16 14.5l-1.7.8L13.5 17l-.8-1.7-1.7-.8 1.7-.8.8-1.7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  settings:
    '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="2.2" stroke="currentColor" stroke-width="1.4"/><path d="M9 1.5v2m0 11v2m7.5-7.5h-2m-11 0h-2M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4M14.3 14.3l-1.4-1.4M5.1 5.1L3.7 3.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  search:
    '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M9 9l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="4" y="8" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M6 8V5.5a3 3 0 016 0V8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
} as const;

type NavGroup = {
  labelKey: 'shell.nav.group.general' | 'shell.nav.group.data' | 'shell.nav.group.ai';
  items: Array<{
    path: string;
    labelKey: Parameters<typeof t>[0];
    icon: string;
    pageTitleKey: Parameters<typeof t>[0];
  }>;
};

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'shell.nav.group.general',
    items: [
      {
        path: '/dashboard',
        labelKey: 'shell.nav.dashboard',
        icon: ICON.dashboard,
        pageTitleKey: 'shell.page.dashboard',
      },
      {
        path: '/records',
        labelKey: 'shell.nav.records',
        icon: ICON.records,
        pageTitleKey: 'shell.page.records',
      },
      {
        path: '/filters',
        labelKey: 'shell.nav.filters',
        icon: ICON.filters,
        pageTitleKey: 'shell.page.filters',
      },
    ],
  },
  {
    labelKey: 'shell.nav.group.data',
    items: [
      {
        path: '/import',
        labelKey: 'shell.nav.import',
        icon: ICON.import,
        pageTitleKey: 'shell.page.import',
      },
      {
        path: '/export',
        labelKey: 'shell.nav.export',
        icon: ICON.export,
        pageTitleKey: 'shell.page.export',
      },
    ],
  },
  {
    labelKey: 'shell.nav.group.ai',
    items: [
      {
        path: '/ai/inconsistencies',
        labelKey: 'shell.nav.inconsistencies',
        icon: ICON.ai,
        pageTitleKey: 'shell.page.inconsistencies',
      },
    ],
  },
];

const FOOTER_ITEM = {
  path: '/settings',
  labelKey: 'shell.nav.settings' as const,
  icon: ICON.settings,
  pageTitleKey: 'shell.page.settings' as const,
};

const PAGE_TITLE_BY_PATH = new Map<string, string>(
  [...NAV_GROUPS.flatMap((g) => g.items), FOOTER_ITEM].map((item) => [
    item.path,
    t(item.pageTitleKey),
  ]),
);

const bootRouter = (unlocked: UnlockedWorkspace): void => {
  currentUnlocked = unlocked;
  root.innerHTML = '';

  // ── App-shell scaffold ─────────────────────────────────────────────
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  root.appendChild(shell);

  /* Sidebar */
  const sidebar = document.createElement('nav');
  sidebar.className = 'app-shell__sidebar';
  sidebar.setAttribute('aria-label', 'Navegación principal');
  shell.appendChild(sidebar);

  // Brand
  const brand = document.createElement('div');
  brand.className = 'app-shell__brand';
  brand.innerHTML = `
    <div class="app-shell__brand-mark" aria-hidden="true">A</div>
    <span class="app-shell__brand-name">${t('common.app.name')}</span>
  `;
  sidebar.appendChild(brand);

  // Workspace pill
  const workspacePill = document.createElement('div');
  workspacePill.className = 'app-shell__workspace';
  workspacePill.innerHTML = `
    <span class="app-shell__workspace-dot" aria-hidden="true"></span>
    <span class="app-shell__workspace-name"></span>
  `;
  const wsName = workspacePill.querySelector<HTMLElement>('.app-shell__workspace-name');
  if (wsName) wsName.textContent = unlocked.payload.workspace.name;
  sidebar.appendChild(workspacePill);

  // Nav groups
  const navContainer = document.createElement('div');
  navContainer.className = 'app-shell__nav';
  sidebar.appendChild(navContainer);

  const navLinks = new Map<string, HTMLAnchorElement>();

  const createNavLink = (
    path: string,
    labelKey: Parameters<typeof t>[0],
    icon: string,
  ): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.className = 'app-shell__nav-link';
    a.href = `#${path}`;
    a.dataset['path'] = path;
    a.innerHTML = `${icon}<span class="app-shell__nav-link-label">${t(labelKey)}</span>`;
    navLinks.set(path, a);
    return a;
  };

  for (const group of NAV_GROUPS) {
    const groupEl = document.createElement('div');
    groupEl.className = 'app-shell__nav-group';
    const labelEl = document.createElement('p');
    labelEl.className = 'app-shell__nav-group-label';
    labelEl.textContent = t(group.labelKey);
    groupEl.appendChild(labelEl);
    for (const item of group.items) {
      groupEl.appendChild(createNavLink(item.path, item.labelKey, item.icon));
    }
    navContainer.appendChild(groupEl);
  }

  // Footer (settings) at the bottom
  const footerNav = document.createElement('div');
  footerNav.className = 'app-shell__footer';
  footerNav.appendChild(createNavLink(FOOTER_ITEM.path, FOOTER_ITEM.labelKey, FOOTER_ITEM.icon));
  sidebar.appendChild(footerNav);

  /* Main column */
  const mainCol = document.createElement('div');
  mainCol.className = 'app-shell__main';
  shell.appendChild(mainCol);

  // Topbar (header role="banner")
  const topbar = document.createElement('header');
  topbar.className = 'app-shell__topbar';
  topbar.setAttribute('role', 'banner');

  const pageTitle = document.createElement('h1');
  pageTitle.id = 'app-heading';
  pageTitle.className = 'app-shell__topbar-title';
  pageTitle.textContent = '';
  topbar.appendChild(pageTitle);

  const spacer = document.createElement('div');
  spacer.className = 'app-shell__topbar-spacer';
  topbar.appendChild(spacer);

  // Search placeholder (not yet wired — Cmd-K is post-MVP)
  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.className = 'app-shell__topbar-search';
  searchBtn.disabled = true;
  searchBtn.title = t('shell.topbar.search.hint');
  searchBtn.innerHTML = `
    ${ICON.search}
    <span class="app-shell__topbar-search-text">${t('shell.topbar.search.placeholder')}</span>
    <kbd>⌘K</kbd>
  `;
  topbar.appendChild(searchBtn);

  // Theme toggle (System / Light / Dark)
  new ThemeToggle(topbar, { themeService });

  mainCol.appendChild(topbar);

  // Main content region
  const main = document.createElement('main');
  main.id = 'main-content';
  main.className = 'app-shell__content';
  main.setAttribute('tabindex', '-1');
  mainCol.appendChild(main);

  // Footer credit
  const footerCredit = document.createElement('footer');
  footerCredit.className = 'app-shell__footer-credit';
  footerCredit.setAttribute('role', 'contentinfo');
  footerCredit.textContent = `${t('common.app.name')} — ${unlocked.payload.workspace.name}`;
  mainCol.appendChild(footerCredit);

  /* Active-route reactivity */
  const updateActiveRoute = (): void => {
    const hash = (globalThis.location.hash || '#/dashboard').replace(/^#/, '');
    let matched: string | null = null;
    for (const [path] of navLinks) {
      if (hash.startsWith(path)) {
        matched = path;
        break;
      }
    }
    for (const [path, link] of navLinks) {
      if (path === matched) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const title = matched ? PAGE_TITLE_BY_PATH.get(matched) : null;
    pageTitle.textContent = title ?? t('common.app.name');
  };

  /* Router */
  const router = createRouter(
    [
      {
        pattern: '/records',
        handler: () => {
          main.innerHTML = '';
          const heading = document.createElement('section');
          heading.className = 'page-header';
          heading.innerHTML = `
            <div>
              <h2 class="page-header__title">${t('shell.page.records')}</h2>
              <p class="page-header__subtitle">${t('records.list.tableLabel')}</p>
            </div>
          `;
          main.appendChild(heading);

          const placeholder = document.createElement('div');
          placeholder.className = 'card';
          placeholder.innerHTML = `<p class="text-muted">${t('records.list.empty')}</p>`;
          main.appendChild(placeholder);
        },
      },
      {
        pattern: '/filters',
        handler: () => {
          main.innerHTML = '';
          const heading = document.createElement('section');
          heading.className = 'page-header';
          heading.innerHTML = `<h2 class="page-header__title">${t('shell.page.filters')}</h2>`;
          main.appendChild(heading);

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
          const heading = document.createElement('section');
          heading.className = 'page-header';
          heading.innerHTML = `<h2 class="page-header__title">${t('shell.page.import')}</h2>`;
          main.appendChild(heading);

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

          const importService = new ImportService({
            persistPayload: () => Promise.resolve(),
          });

          let lastReport: import('./modules/import/domain/types.js').ValidationReport | null = null;

          const reportView = new ValidationReportView(reportHost, {
            onCommit: () => {
              progress.showCommitting();
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
          const heading = document.createElement('section');
          heading.className = 'page-header';
          heading.innerHTML = `<h2 class="page-header__title">${t('shell.page.export')}</h2>`;
          main.appendChild(heading);

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
          const heading = document.createElement('section');
          heading.className = 'page-header';
          heading.innerHTML = `<h2 class="page-header__title">${t('shell.page.dashboard')}</h2>`;
          main.appendChild(heading);

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
          const heading = document.createElement('section');
          heading.className = 'page-header';
          heading.innerHTML = `<h2 class="page-header__title">${t('shell.page.inconsistencies')}</h2>`;
          main.appendChild(heading);

          const viewHost = document.createElement('section');
          viewHost.className = 'ai-inconsistencies-host';
          main.appendChild(viewHost);

          const aiService = new AiService({
            settings: { aiEnabled: true },
            persistFindings: () => Promise.resolve(),
          });

          const view = new InconsistenciesView(viewHost, {
            onDismiss: () => {
              /* Full wiring deferred to workspace-store integration task. */
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
          const heading = document.createElement('section');
          heading.className = 'page-header';
          heading.innerHTML = `<h2 class="page-header__title">${t('shell.page.settings')}</h2>`;
          main.appendChild(heading);

          const settingsHost = document.createElement('section');
          settingsHost.className = 'ai-settings-host';
          main.appendChild(settingsHost);

          new AiSettingsPanel(settingsHost, {
            initialEnabled: true,
            onToggle: () => {
              /* Full persistence wiring deferred to workspace-store integration task. */
            },
          });
        },
      },
      {
        pattern: '/not-found',
        handler: () => {
          main.innerHTML = '';
          const heading = document.createElement('section');
          heading.className = 'page-header';
          heading.innerHTML = `<h2 class="page-header__title">${t('shell.page.notFound')}</h2>`;
          main.appendChild(heading);
        },
      },
    ],
    { defaultPath: '/dashboard', notFoundPath: '/not-found' },
  );

  // Focus-restore + sidebar/title sync on route change (FR-037 / SC-012)
  globalThis.addEventListener('hashchange', () => {
    const mainEl = document.getElementById('main-content');
    if (mainEl) mainEl.focus();
    updateActiveRoute();
  });

  updateActiveRoute();
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
