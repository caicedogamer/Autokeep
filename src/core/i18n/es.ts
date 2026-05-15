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

  // Flexible import — semantic roles (FR-042/043)
  'import.role.date': 'Fecha',
  'import.role.type': 'Tipo',
  'import.role.amount': 'Importe',
  'import.role.category': 'Categoría',
  'import.role.description': 'Descripción',
  'import.role.counterparty': 'Contraparte',
  'import.role.currency': 'Moneda',
  'import.role.metadata': 'Metadato',
  'import.role.ignore': 'Ignorar',

  // Flexible import — confidence levels (Alta / Media / Baja, never raw decimals)
  'import.confidence.high': 'Alta',
  'import.confidence.medium': 'Media',
  'import.confidence.low': 'Baja',

  // Flexible import — mapping warnings (FR-046)
  'import.warning.AMBIGUOUS_ROLE':
    'Hay varias columnas candidatas para el mismo rol. Elige cuál usar.',
  'import.warning.LOW_CONFIDENCE':
    'La detección automática tiene baja confianza. Verifica la asignación.',
  'import.warning.MIXED_TYPE_COLUMN': 'Esta columna tiene valores de tipos mezclados.',
  'import.warning.MISSING_REQUIRED_ROLE': 'Falta asignar una columna para un campo obligatorio.',
  'import.warning.CURRENCY_DIFFERS_FROM_WORKSPACE':
    'La moneda del archivo no coincide con la del espacio de trabajo.',
  'import.warning.AMBIGUOUS_DATE_FORMAT':
    'El formato de fecha es ambiguo (DD/MM o MM/DD). Selecciona uno.',
  'import.warning.AMBIGUOUS_DECIMAL_SEPARATOR':
    'El separador decimal es ambiguo. Selecciona punto o coma.',
  'import.warning.AMBIGUOUS_AMOUNT_CONVENTION':
    'Los importes podrían estar en unidades menores (centavos) o decimales. Confirma cuál.',

  // Flexible import — row error codes (FR-013)
  'import.error.INVALID_DATE': 'Fecha inválida.',
  'import.error.INVALID_TYPE': 'Tipo de movimiento inválido.',
  'import.error.INVALID_AMOUNT_FORMAT': 'Formato de importe inválido.',
  'import.error.AMOUNT_NOT_POSITIVE': 'El importe debe ser mayor que cero.',
  'import.error.CURRENCY_DIFFERS_FROM_WORKSPACE': 'La moneda no coincide con el espacio.',
  'import.error.CATEGORY_REQUIRED': 'Falta la categoría.',
  'import.error.CATEGORY_TOO_LONG': 'La categoría supera los 60 caracteres.',
  'import.error.DESCRIPTION_REQUIRED': 'Falta la descripción.',
  'import.error.DESCRIPTION_TOO_LONG': 'La descripción supera los 280 caracteres.',
  'import.error.COUNTERPARTY_TOO_LONG': 'La contraparte supera los 120 caracteres.',
  'import.error.MISSING_REQUIRED_ROLE_AFTER_MAPPING':
    'Falta una columna obligatoria después del mapeo.',
  'import.error.METADATA_KEY_TOO_LONG': 'El nombre de un metadato supera los 60 caracteres.',
  'import.error.METADATA_VALUE_TOO_LONG': 'Un valor de metadato supera los 200 caracteres.',
  'import.error.METADATA_TOO_MANY_FIELDS': 'Hay más de 10 metadatos por registro.',

  // Flexible import — parser-level rejection codes (FR-015)
  'import.parser.EMPTY_FILE': 'El archivo está vacío.',
  'import.parser.ENCODING_NOT_UTF8':
    'La codificación del archivo no es compatible (UTF-8 o UTF-16).',
  'import.parser.MALFORMED_CSV': 'El archivo CSV está mal formado y no se puede leer.',
  'import.parser.MALFORMED_JSON': 'El archivo JSON está mal formado y no se puede leer.',
  'import.parser.WRONG_TOP_LEVEL_SHAPE':
    'El archivo JSON no tiene una estructura reconocible (array, objeto con registros, o NDJSON).',

  // Flexible import — pipeline stages
  'import.stage.parse': 'Leyendo archivo…',
  'import.stage.infer': 'Detectando columnas…',
  'import.stage.confirm': 'Confirmando mapeo',
  'import.stage.normalize': 'Normalizando filas…',
  'import.stage.validate': 'Validando datos…',
  'import.stage.commit': 'Importando registros…',

  // Flexible import — UI labels (mapping preview)
  'import.mapping.title': 'Mapeo de columnas',
  'import.mapping.subtitle':
    'Confirma o corrige cómo se interpreta cada columna del archivo antes de validar.',
  'import.mapping.confirm': 'Confirmar e importar',
  'import.mapping.cancel': 'Cancelar',
  'import.mapping.colRole': 'Rol',

  // Flexible import — operator resolutions (when inferrer needs help)
  'import.resolution.amountConvention.title': '¿En qué unidad vienen los importes?',
  'import.resolution.amountConvention.minorUnits': 'Centavos (ej. 1500 = $15,00)',
  'import.resolution.amountConvention.majorDecimal': 'Unidades + decimales (ej. 150,00 = $150,00)',
  'import.resolution.dateFormat.title': 'Formato de fecha',
  'import.resolution.dateFormat.iso': 'ISO (AAAA-MM-DD)',
  'import.resolution.dateFormat.ddmmyyyy': 'DD/MM/AAAA',
  'import.resolution.dateFormat.mmddyyyy': 'MM/DD/AAAA',
  'import.resolution.decimalSeparator.title': 'Separador decimal',
  'import.resolution.decimalSeparator.dot': 'Punto (1,234.56)',
  'import.resolution.decimalSeparator.comma': 'Coma (1.234,56)',
  'import.resolution.confirmHint': 'Selecciona una opción para continuar.',

  // Confirm-button hints
  'import.confirm.missingRoles': 'Falta mapear: {roles}',
  'import.confirm.pending': 'Falta confirmar: {what}',

  // Post-commit
  'import.commit.viewRecords': 'Ver registros',
} as const;

export type CopyKey = keyof typeof es;
