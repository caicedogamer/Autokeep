/// <reference lib="webworker" />
/*
 * Import worker — runs CSV/JSON parsing + validation off-thread.
 *
 * Supports two protocols:
 *
 *   Legacy v1 (kind: 'import'):
 *     IN:  ImportRequest { kind:'import', requestId, fileKind, fileBuffer, ctx }
 *     OUT: ImportFinalMessage { kind:'import-final', requestId, structuralOk, report }
 *
 *   Flexible v2 (US3v2) — three-stage pipeline:
 *     IN:  { kind: 'pipeline-parse' }            → OUT: 'pipeline-parsed'
 *     IN:  { kind: 'pipeline-infer' }            → OUT: 'pipeline-inferred'
 *     IN:  { kind: 'pipeline-normalize-validate' } → OUT: 'pipeline-validated'
 */

import Papa from 'papaparse';

import type {
  ImportFinalMessage,
  ImportInbound,
  ImportPipelineRequest,
  ImportPipelineResponse,
} from './messages.js';
import type {
  ImportCtx,
  InferenceContext,
  MappingDecision,
  RawTable,
  ValidationReport,
} from '../../modules/import/domain/types.js';
import { validateCsvRows } from '../../modules/import/domain/csv-schema.js';
import { validateJsonPayload } from '../../modules/import/domain/json-schema.js';
import { parseCsv } from '../../modules/import/domain/parsing/csv-parser.js';
import { parseJson } from '../../modules/import/domain/parsing/json-parser.js';
import { HeuristicColumnMapper } from '../../modules/import/domain/inference/heuristic-column-mapper.js';
import { normalize } from '../../modules/import/domain/normalization/normalizer.js';
import { validate } from '../../modules/import/domain/validation/validator.js';

const workerCtx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

const mapper = new HeuristicColumnMapper();

workerCtx.addEventListener('message', (event: MessageEvent<ImportInbound>) => {
  const inbound = event.data;

  switch (inbound.kind) {
    case 'import':
      handleLegacyImport(inbound);
      return;
    case 'pipeline-parse':
    case 'pipeline-infer':
    case 'pipeline-normalize-validate':
      handlePipeline(inbound);
      return;
    case 'cancel':
      // Stateless worker; cancel is a no-op (the caller stops waiting).
      return;
  }
});

/* ---------------- Legacy v1 path ---------------- */

function handleLegacyImport(inbound: Extract<ImportInbound, { kind: 'import' }>): void {
  const { requestId, fileKind, fileBuffer, ctx: importCtx } = inbound;
  const importContext: ImportCtx = importCtx;

  let report: ValidationReport;

  if (fileKind === 'csv') {
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

    const parsed = Papa.parse<string[]>(stripped, { skipEmptyLines: true });
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
}

function postFinal(requestId: string, report: ValidationReport): void {
  const response: ImportFinalMessage = {
    kind: 'import-final',
    requestId,
    structuralOk: report.outcome !== 'rejected-structural',
    report,
  };
  workerCtx.postMessage(response);
}

/* ---------------- Flexible v2 pipeline path ---------------- */

function handlePipeline(inbound: ImportPipelineRequest): void {
  const { requestId } = inbound;
  try {
    switch (inbound.kind) {
      case 'pipeline-parse': {
        const result =
          inbound.fileKind === 'csv' ? parseCsv(inbound.fileBuffer) : parseJson(inbound.fileBuffer);
        const response: ImportPipelineResponse = {
          kind: 'pipeline-parsed',
          requestId,
          ...(result.table ? { table: result.table } : {}),
          ...(result.rejection ? { rejection: result.rejection } : {}),
        };
        workerCtx.postMessage(response);
        return;
      }
      case 'pipeline-infer': {
        const table = inbound.table as RawTable;
        const ctx = inbound.ctx as InferenceContext;
        const report = mapper.infer(table, ctx);
        const response: ImportPipelineResponse = {
          kind: 'pipeline-inferred',
          requestId,
          report,
        };
        workerCtx.postMessage(response);
        return;
      }
      case 'pipeline-normalize-validate': {
        const table = inbound.table as RawTable;
        const decision = inbound.decision as MappingDecision;
        const ctx = inbound.ctx as ImportCtx;
        const normalized = normalize(table, decision);
        const report = validate({ rows: normalized, decision, ctx });
        const response: ImportPipelineResponse = {
          kind: 'pipeline-validated',
          requestId,
          report,
        };
        workerCtx.postMessage(response);
        return;
      }
    }
  } catch (err) {
    const response: ImportPipelineResponse = {
      kind: 'pipeline-error',
      requestId,
      reason: err instanceof Error ? err.message : 'Unknown pipeline error',
    };
    workerCtx.postMessage(response);
  }
}
