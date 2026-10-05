import type { AgentToolSchema } from '../../tool-schema';
export const VISUAL_COMPOSITION_TOOL_SCHEMAS: AgentToolSchema[] = [{
  name: 'edit_visual_composition',
  description: 'Execute a normalized, reviewed XMT VisualCompositionV1 as editable native timelines. Shared XMT component builder supplies nodes; arbitrary code is rejected.',
  input_schema: { type: 'object', properties: {
    action: { type: 'string', enum: ['create', 'update', 'delete'] },
    composition_id: { type: 'string' }, composition: { type: 'object' }, nodes: { type: 'array', items: { type: 'object' } },
    template_id: { type: 'string', enum: ['xmt-composition-node-v1'] }, intro_ms: { type: 'number' },
  }, required: ['action', 'composition_id'] },
}];
export const VISUAL_COMPOSITION_TOOL_NAMES = new Set(VISUAL_COMPOSITION_TOOL_SCHEMAS.map((tool) => tool.name));
