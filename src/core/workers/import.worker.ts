/// <reference lib="webworker" />
/*
 * Import worker — validates CSV/JSON files off-thread (T061 / US3).
 *
 * Protocol:
 *   IN:  ImportRequest  { kind:'import', requestId, fileKind, fileBuffer, ctx }
 *   OUT: ImportFinalMessage { kind:'import-final', requestId, structuralOk, report }
 *
 * CSV path: PapaParse → validateCsvRows()
 * JSON path: JSON.parse → validateJsonPayload()
 */

import Papa from 'papaparse';

import type { ImportFinalMessage, ImportInbound } from './messages.js';
import type { ImportCtx, ValidationReport } from '../../modules/import/domain/types.js';
import { validateCsvRows } from '../../modules/import/domain/csv-schema.js';
import { validateJsonPayload } from '../../modules/import/domain/json-schema.js';

const workerCtx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerCtx.addEventListener('message', (event: MessageEvent<ImportInbound>) => {
  const inbound = event.data;
  if (inbound.kind !== 'import') return;

  const { requestId, fileKind, fileBuffer, ctx: importCtx } = inbound;
  const importContext: ImportCtx = importCtx;

  let report: ValidationReport;

  if (fileKind === 'csv') {
    // Decode UTF-8
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(fileBuffer);
    } catch {
      report = {
        outcome: 'rejected-structural',
        structuralCode: 'ENCODING_NOT_UTF8',
        totalRows: 0,
        validRows: [],
        errorRows: [],
      };
      postFinal(requestId, report);
      return;
    }

    // Strip BOM if present
    const stripped = text.startsWith('﻿') ? text.slice(1) : text;

    if (!stripped.trim()) {
      report = {
        outcome: 'rejected-structural',
        structuralCode: 'EMPTY_FILE',
        totalRows: 0,
        validRows: [],
        errorRows: [],
      };
      postFinal(requestId, report);
      return;
    }

    const parsed = Papa.parse<string[]>(stripped, {
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      report = {
        outcome: 'rejected-structural',
        structuralCode: 'MALFORMED_CSV',
        totalRows: 0,
        validRows: [],
        errorRows: [],
      };
      postFinal(requestId, report);
      return;
    }

    const [headers, ...rows] = parsed.data;
    if (!headers || headers.length === 0) {
      report = {
        outcome: 'rejected-structural',
        structuralCode: 'HEADER_MISSING',
        totalRows: 0,
        validRows: [],
        errorRows: [],
      };
      postFinal(requestId, report);
      return;
    }

    report = validateCsvRows({ headers, rows }, importContext);
  } else {
    // JSON
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(fileBuffer);
    } catch {
      report = {
        outcome: 'rejected-structural',
        structuralCode: 'MALFORMED_JSON',
        totalRows: 0,
        validRows: [],
        errorRows: [],
      };
      postFinal(requestId, report);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      report = {
        outcome: 'rejected-structural',
        structuralCode: 'MALFORMED_JSON',
        totalRows: 0,
        validRows: [],
        errorRows: [],
      };
      postFinal(requestId, report);
      return;
    }

    report = validateJsonPayload(parsed, importContext);
  }

  postFinal(requestId, report);
});

function postFinal(requestId: string, report: ValidationReport): void {
  const response: ImportFinalMessage = {
    kind: 'import-final',
    requestId,
    structuralOk: report.outcome !== 'rejected-structural',
    report,
  };
  workerCtx.postMessage(response);
}
