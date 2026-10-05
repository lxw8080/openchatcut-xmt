/**
 * Headless editing session: runs the same agent tool executors the browser
 * agent uses, against an in-memory ProjectDoc, without React, IndexedDB or a
 * DOM. Used by XMT's server-side worker (scripts/headless) so an external
 * director can edit a project nobody has open in /editor.
 *
 * Invariants:
 * - A batch is atomic: every call runs on a scratch draft; if any call
 *   reports an error, the original document is returned untouched.
 * - The resulting document must pass the same migration/shape gate the
 *   editor applies on load (runProjectMigrations). A batch that would produce
 *   a document the editor refuses to open is rejected, not saved.
 * - Only whitelisted tools are reachable (HEADLESS_TOOLS). Tools that need a
 *   browser (media import, generation, export, IndexedDB-backed stores) are
 *   not exposed.
 * - Motion-graphic templates come only from the caller (XMT's own template
 *   files); the headless session has no template store of its own, and model
 *   generated MG code is never reachable here.
 */
import type { Tpl } from '../types';
import { makeDraft } from '../editor/store';
import type { ProjectDoc } from '../editor/projectTypes';
import { runProjectMigrations } from '../persist/migrations';

/** Tools that only read or rewrite the project document. */
export const HEADLESS_READ_TOOLS = [
  'read_timeline',
  'read_captions',
  'list_templates',
  'search_templates',
  'browse_library',
] as const;
export const HEADLESS_WRITE_TOOLS = [
  'edit_item',
  'split_item',
  'move_item',
  'set_item_timing',
  'duplicate_item',
  'remove_item',
  'edit_track',
  'edit_captions',
  'update_item_props',
  'manage_markers',
  'manage_timelines',
  'add_motion_graphic',
  'edit_visual_composition',
] as const;
export const HEADLESS_TOOLS: readonly string[] = [...HEADLESS_READ_TOOLS, ...HEADLESS_WRITE_TOOLS];

export interface ToolCall {
  name: string;
  args?: Record<string, unknown>;
}

export interface CallOutcome {
  name: string;
  ok: boolean;
  result: unknown;
  error?: string;
}

export interface BatchOutcome {
  ok: boolean;
  changed: boolean;
  results: CallOutcome[];
  doc: ProjectDoc;
  error?: string;
}

type Executor = (name: string, args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;

let executorPromise: Promise<Executor> | null = null;

async function loadExecutor(): Promise<Executor> {
  if (!executorPromise) {
    executorPromise = import('../agent/tools').then(
      (mod) => (name, args, ctx) => mod.executeTool(name, args, ctx as never),
    );
  }
  return executorPromise;
}

export function loadDoc(input: unknown): ProjectDoc {
  const migrated = runProjectMigrations(input);
  if (!migrated) throw new Error('invalid_project_doc');
  return migrated.doc;
}

function resultError(result: unknown): string | undefined {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.error === 'string' && r.error) return r.error;
    if (r.ok === false) return typeof r.message === 'string' ? r.message : 'tool_failed';
  }
  if (typeof result === 'string' && /^(error|错误)[:：]/i.test(result.trim())) return result.trim();
  return undefined;
}

function asTemplates(input: unknown): Tpl[] {
  if (!Array.isArray(input)) return [];
  return input.filter((t): t is Tpl => {
    if (!t || typeof t !== 'object') return false;
    const r = t as Record<string, unknown>;
    return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.code === 'string'
      && typeof r.category === 'string' && typeof r.durationInFrames === 'number';
  });
}

function headlessContext(engine: ReturnType<typeof makeDraft>, templates: Tpl[]) {
  return {
    commands: engine.commands,
    getState: engine.getState,
    getDoc: engine.getDoc,
    getCreativeMode: () => null,
    templates,
    audio: [],
    getApprovalMode: () => 'auto',
  };
}

export async function runBatch(
  input: unknown,
  calls: ToolCall[],
  templates?: unknown,
): Promise<BatchOutcome> {
  const base = loadDoc(input);
  const engine = makeDraft(base);
  const ctx = headlessContext(engine, asTemplates(templates));
  const exec = await loadExecutor();
  const results: CallOutcome[] = [];
  for (const call of calls) {
    if (!HEADLESS_TOOLS.includes(call.name)) {
      return { ok: false, changed: false, results, doc: base, error: `tool_not_allowed:${call.name}` };
    }
    let result: unknown;
    try {
      result = await exec(call.name, call.args ?? {}, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: call.name, ok: false, result: null, error: message });
      return { ok: false, changed: false, results, doc: base, error: message };
    }
    const error = resultError(result);
    results.push({ name: call.name, ok: !error, result, ...(error ? { error } : {}) });
    if (error) return { ok: false, changed: false, results, doc: base, error };
  }
  const next = engine.getDoc();
  if (next === base) return { ok: true, changed: false, results, doc: base };
  const validated = runProjectMigrations(JSON.parse(JSON.stringify(next)));
  if (!validated) {
    return { ok: false, changed: false, results, doc: base, error: 'result_doc_invalid' };
  }
  return { ok: true, changed: true, results, doc: validated.doc };
}

export async function toolSchemas(): Promise<unknown[]> {
  const mod = await import('../agent/tools');
  const all = (mod as { TOOL_SCHEMAS?: Array<{ name?: string }> }).TOOL_SCHEMAS ?? [];
  return all.filter((s) => s && typeof s.name === 'string' && HEADLESS_TOOLS.includes(s.name));
}
