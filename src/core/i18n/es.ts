/*
 * Spanish (es) UI copy bundle.
 *
 * The shape of this object IS the dictionary type. Every key used in the
 * UI must exist here at compile time (FR-038). Future languages add a
 * sibling file (e.g. `en.ts`) with the same keys, and the language
 * selector swaps the bundle.
 *
 * Keys are flat dotted strings grouped by module — kept flat (no nested
 * objects) so static lookups stay O(1) and the type stays readable.
 */
export const es = {
  // Generic
  'common.app.name': 'AutoKeep',
  'common.action.save': 'Guardar',
  'common.action.cancel': 'Cancelar',
  'common.action.delete': 'Eliminar',
  'common.action.confirm': 'Confirmar',
  'common.action.close': 'Cerrar',
  'common.action.retry': 'Reintentar',
  'common.action.clearAll': 'Limpiar todo',
  'common.empty': 'Sin resultados',
  'common.loading': 'Cargando…',

  // Boot
  'boot.pendingMessage': 'AutoKeep — bootstrap pendiente.',

  // Workspace
  'workspace.setup.title': 'Crear espacio de trabajo',
  'workspace.setup.passphraseHelp':
    'Tu contraseña cifra todos los datos en este navegador. AutoKeep no puede recuperarla; si la pierdes, perderás el acceso al espacio de trabajo. Mantén un respaldo exportando tus datos regularmente.',
  'workspace.unlock.title': 'Desbloquear espacio de trabajo',
  'workspace.unlock.wrongPassphrase': 'Contraseña incorrecta.',
  'workspace.unlock.throttle':
    'Demasiados intentos fallidos. Por favor, espera unos segundos antes de reintentar.',
  'workspace.changePassphrase.title': 'Cambiar contraseña',

  // Capacity (FR-041)
  'capacity.softWarning':
    'Estás cerca del límite de registros de este espacio de trabajo. Considera exportar tus datos.',
  'capacity.hardCap':
    'Este espacio de trabajo alcanzó el máximo de 12.000 registros. Exporta tus datos y comienza un nuevo espacio de trabajo para continuar agregando registros.',

  // Storage / quota
  'quota.warning':
    'El almacenamiento del navegador está casi lleno. Exporta tus datos para liberar espacio.',

  // Common actions (short aliases used in components)
  'common.edit': 'Editar',
  'common.delete': 'Eliminar',
  'common.cancel': 'Cancelar',
  'common.save': 'Guardar',
  'common.create': 'Crear',

  // Records list
  'records.list.empty': 'No hay registros para mostrar.',
  'records.list.tableLabel': 'Registros financieros',
  'records.col.date': 'Fecha',
  'records.col.type': 'Tipo',
  'records.col.description': 'Descripción',
  'records.col.category': 'Categoría',
  'records.col.amount': 'Importe',
  'records.col.actions': 'Acciones',
  'records.type.income': 'Ingreso',
  'records.type.expense': 'Egreso',

  // Record form
  'records.form.titleNew': 'Nuevo registro',
  'records.form.titleEdit': 'Editar registro',
  'records.form.date': 'Fecha',
  'records.form.type': 'Tipo',
  'records.form.amount': 'Importe',
  'records.form.category': 'Categoría',
  'records.form.description': 'Descripción',
  'records.form.counterparty': 'Contraparte',
  'records.form.noCounterparty': '— Sin contraparte —',
  'records.form.error.invalidAmount': 'Importe inválido. Usa un número positivo.',
  'records.form.error.descriptionRequired': 'La descripción es obligatoria.',

  // Conflict dialog (FR-036)
  'records.conflict.title': 'Conflicto de versión',
  'records.conflict.body': 'Este registro fue modificado por otra pestaña. ¿Qué deseas hacer?',
  'records.conflict.keepStored': 'Mantener la versión guardada',
  'records.conflict.forceOverwrite': 'Sobrescribir con mis cambios',

  // Delete confirm
  'records.delete.title': 'Eliminar registro',
  'records.delete.body': '¿Eliminar "{description}"? Esta acción no se puede deshacer.',
  'records.delete.confirm': 'Eliminar',

  // Workspace screens
  'workspace.setup.name': 'Nombre del espacio de trabajo',
  'workspace.setup.currency': 'Moneda',
  'workspace.setup.locale': 'Idioma / formato regional',
  'workspace.setup.passphrase': 'Contraseña',
  'workspace.setup.passphraseConfirm': 'Confirmar contraseña',
  'workspace.setup.submit': 'Crear espacio de trabajo',
  'workspace.setup.error.nameTooShort': 'El nombre debe tener al menos 1 carácter.',
  'workspace.setup.error.passphraseTooShort': 'La contraseña debe tener al menos 8 caracteres.',
  'workspace.setup.error.passphraseMismatch': 'Las contraseñas no coinciden.',
  'workspace.unlock.passphrase': 'Contraseña',
  'workspace.unlock.submit': 'Desbloquear',
  'workspace.unlock.createNew': 'Crear nuevo espacio de trabajo',
  'workspace.changePassphrase.currentPassphrase': 'Contraseña actual',
  'workspace.changePassphrase.newPassphrase': 'Nueva contraseña',
  'workspace.changePassphrase.confirmPassphrase': 'Confirmar nueva contraseña',
  'workspace.changePassphrase.submit': 'Cambiar contraseña',
  'workspace.changePassphrase.error.mismatch': 'Las contraseñas no coinciden.',
  'workspace.changePassphrase.success': 'Contraseña cambiada correctamente.',
  'workspace.privacy.title': 'Resumen de privacidad',
  'workspace.privacy.body':
    'Todos los registros se cifran con tu contraseña antes de guardarse en el navegador. AutoKeep no transmite datos financieros. La contraseña nunca abandona este dispositivo.',
  'workspace.privacy.close': 'Entendido',

  // Filter bar (US2)
  'filters.bar.label': 'Filtros',
  'filters.bar.query': 'Buscar descripción…',
  'filters.bar.dateFrom': 'Desde',
  'filters.bar.dateTo': 'Hasta',
  'filters.bar.types': 'Tipo',
  'filters.bar.category': 'Categoría',
  'filters.bar.counterparty': 'Contraparte',
  'filters.bar.amountMin': 'Importe mínimo',
  'filters.bar.amountMax': 'Importe máximo',
  'filters.bar.apply': 'Aplicar filtros',
  'filters.bar.clear': 'Limpiar filtros',

  // Active filter chips
  'filters.active.label': 'Filtros activos',
  'filters.active.clearAll': 'Limpiar todo',
  'filters.active.removeChip': 'Eliminar filtro: {label}',

  // Result count
  'filters.results.count': '{count} resultado(s)',
  'filters.results.empty': 'Sin resultados para los filtros aplicados.',
  'filters.results.all': 'Mostrando todos los registros.',

  // Import module (US3)
  'import.picker.label': 'Arrastra un archivo CSV o JSON aquí, o haz clic para seleccionar',
  'import.commit': 'Importar registros',
  'import.success': '{count} registro(s) importado(s) correctamente.',
  'import.error.structural': 'El archivo no pudo importarse: {code}.',

  // Export module (US4)
  'export.title': 'Exportar registros',
  'export.format.label': 'Formato de exportación',
  'export.confirm': 'Exportar',
  'export.empty.title': 'Exportación vacía',
  'export.empty.body':
    'El filtro activo no produce registros. ¿Deseas exportar un archivo vacío (solo encabezado)?',
  'export.empty.confirm': 'Exportar de todas formas',

  // App shell — sidebar nav
  'shell.nav.group.general': 'General',
  'shell.nav.group.data': 'Datos',
  'shell.nav.group.ai': 'IA',
  'shell.nav.group.system': 'Sistema',
  'shell.nav.dashboard': 'Tablero',
  'shell.nav.records': 'Registros',
  'shell.nav.filters': 'Filtros',
  'shell.nav.import': 'Importar',
  'shell.nav.export': 'Exportar',
  'shell.nav.inconsistencies': 'Inconsistencias',
  'shell.nav.settings': 'Ajustes',

  // App shell — topbar
  'shell.topbar.search.placeholder': 'Buscar…',
  'shell.topbar.search.hint': 'Próximamente',
  'shell.topbar.lock': 'Bloquear espacio',

  // Page titles (one per route)
  'shell.page.dashboard': 'Tablero',
  'shell.page.records': 'Registros',
  'shell.page.filters': 'Filtros',
  'shell.page.import': 'Importar datos',
  'shell.page.export': 'Exportar datos',
  'shell.page.inconsistencies': 'Inconsistencias',
  'shell.page.settings': 'Ajustes',
  'shell.page.notFound': 'Página no encontrada',

  // Theme toggle
  'theme.toggle.label': 'Tema',
  'theme.option.system': 'Tema del sistema',
  'theme.option.light': 'Tema claro',
  'theme.option.dark': 'Tema oscuro',
} as const;

export type CopyKey = keyof typeof es;
