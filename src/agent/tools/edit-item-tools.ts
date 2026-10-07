export { EDIT_ITEM_TOOL_SCHEMAS, EDIT_ITEM_TOOL_NAMES } from './schemas/edit-item-tools';
import type { AgentContext } from '../context';
import { makeDraft } from '../../editor/store';
import type { DraftEngine } from '../../editor/store';
import { executeAtomicEditBatch } from './edit-item-batch';
import type { EditItemOperation } from './edit-item-batch';
import { commitPlan } from './edit-item-commit';
import type { Args, OpResult } from './edit-item-shared';
import { validateAdd, validateDelete, validateUpdate } from './edit-item-validate';

interface EditItemDraft {
  engine: DraftEngine;
  context: AgentContext;
}

function validateOperation(draft: EditItemDraft, operation: EditItemOperation): OpResult {
  if (operation.bucket === 'adds') return validateAdd(draft.context, operation.entry);
  if (operation.bucket === 'updates') return validateUpdate(draft.context, operation.entry);
  return validateDelete(draft.context, operation.entry);
}

export async function execEditItemTool(
  name: string,
  args: Args,
  ctx: AgentContext,
): Promise<unknown> {
  if (name !== 'edit_item') return { error: `unknown tool ${name}` };
  const ripple = args.ripple === true;
  return executeAtomicEditBatch<EditItemDraft>(args, {
    createDraft: () => {
      const engine = makeDraft(ctx.getDoc());
      return {
        engine,
        context: {
          ...ctx,
          commands: engine.commands,
          getState: engine.getState,
          getDoc: engine.getDoc,
        },
      };
    },
    validate: validateOperation,
    apply: (draft, plan) => {
      const before = new Set(draft.context.getState().items.map((item) => item.id));
      const result = commitPlan(draft.context, plan, ripple);
      if (result.error) return result;
      const created = draft.context.getState().items.filter((item) => !before.has(item.id));
      const placed = result.placed as { itemId?: string } | undefined;
      const id = plan.itemId ?? result.itemId ?? placed?.itemId ?? result.id
        ?? (created.length === 1 ? created[0].id : undefined);
      const item = draft.context.getState().items.find((candidate) => candidate.id === id);
      if (plan.plan === 'genericUpdate' || ['addMedia', 'addMg', 'addAudio', 'addText', 'addSolid'].includes(String(plan.plan))) {
        if (!item) return { error: 'item was not created or updated; entire batch rolled back' };
        for (const key of ['startFrame', 'durationInFrames', 'srcInFrame', 'track'] as const) {
          if (plan[key] !== undefined && item[key] !== plan[key]) {
            return { error: `requested ${key}=${String(plan[key])} was not applied (actual ${String(item[key])}); adjust placement or source capacity; entire batch rolled back` };
          }
        }
      }
      return result;
    },
    publish: (draft) => ctx.commands.applyDoc(draft.engine.getDoc()),
  });
}
