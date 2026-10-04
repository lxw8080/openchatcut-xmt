/**
 * Line-delimited JSON-RPC worker over stdin/stdout.
 *
 * One request per line: {"id": any, "method": string, "params": object}.
 * One response per line: {"id": any, "result": ...} or {"id": any, "error": {"code","message"}}.
 * Nothing else may be written to stdout (tool code that logs is redirected to stderr).
 *
 * Methods:
 *   ping                      -> {"pong": true}
 *   capabilities              -> {protocol, node, tools, read_tools, write_tools, build}
 *   tool_schemas              -> {schemas}
 *   apply {doc, calls, templates?} -> BatchOutcome (atomic; doc unchanged unless ok)
 *   validate {doc}            -> {ok, doc?}
 */
import * as readline from 'node:readline';
import {
  HEADLESS_READ_TOOLS,
  HEADLESS_TOOLS,
  HEADLESS_WRITE_TOOLS,
  loadDoc,
  runBatch,
  toolSchemas,
  type ToolCall,
} from './context';

declare const __HEADLESS_BUILD__: { commit: string; builtAt: string } | undefined;

const PROTOCOL = 2;
const out = process.stdout;
// Tool executors occasionally console.log; keep stdout a clean protocol channel.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);

function send(payload: unknown): void {
  out.write(`${JSON.stringify(payload)}\n`);
}

async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'ping':
      return { pong: true };
    case 'capabilities':
      return {
        protocol: PROTOCOL,
        node: process.version,
        tools: HEADLESS_TOOLS,
        read_tools: HEADLESS_READ_TOOLS,
        write_tools: HEADLESS_WRITE_TOOLS,
        build: typeof __HEADLESS_BUILD__ === 'undefined' ? null : __HEADLESS_BUILD__,
      };
    case 'tool_schemas':
      return { schemas: await toolSchemas() };
    case 'validate':
      try {
        return { ok: true, doc: loadDoc(params.doc) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    case 'apply': {
      const calls = Array.isArray(params.calls) ? (params.calls as ToolCall[]) : [];
      if (!calls.length) throw Object.assign(new Error('calls_required'), { code: 'invalid_params' });
      return runBatch(params.doc, calls, params.templates);
    }
    default:
      throw Object.assign(new Error(`unknown_method:${method}`), { code: 'method_not_found' });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain: Promise<void> = Promise.resolve();
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  chain = chain.then(async () => {
    let id: unknown = null;
    try {
      const req = JSON.parse(text) as { id?: unknown; method?: string; params?: Record<string, unknown> };
      id = req.id ?? null;
      const result = await handle(String(req.method ?? ''), req.params ?? {});
      send({ id, result });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      send({ id, error: { code: e.code ?? 'internal_error', message: e.message ?? String(err) } });
    }
  });
});
rl.on('close', () => {
  // stdout to a pipe is asynchronous: exit only after everything queued is flushed.
  void chain.then(() => out.write('', () => process.exit(0)));
});
