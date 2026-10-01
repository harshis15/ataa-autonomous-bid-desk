import Ajv from 'ajv';
import { schemas } from '../shared/schemas.js';
import { priceBOM, requiredRuleIds, calculateServices, assertReferences } from '../shared/engine.js';

const ajv = new Ajv({ allErrors: true });
const validators = Object.fromEntries(Object.entries(schemas).map(([k, s]) => [k, ajv.compile(s)]));
export function validate(stage, x) { if (!validators[stage](x)) throw Error('Invalid ' + stage + ' output: ' + ajv.errorsText(validators[stage].errors)); return x; }
async function agent(stage, input, b, job, refs, saveJob) {
    const { catalog, rules } = refs;
    if (b.mode === 'demo') { await new Promise(r => setTimeout(r, 650)); if (stage === 'scope') return structuredClone(refs.fixtures.scope); if (stage === 'bom') return structuredClone(refs.fixtures.bom); if (stage === 'architecture') return structuredClone(refs.fixtures.architecture); return { rule_ids: requiredRuleIds(b.scope, rules), notes: ['Synthetic demonstration rates. Support excluded until an SLA and rule are supplied.'] }; }
    throw Error('Live AI requires the local Node backend.');
}

export async function runStage(stage, b, job, refs, saveJob) {
    const { catalog, rules } = refs;
    if (stage === 'scope') {
        const x = await agent(stage, { document_name: b.document.name, rfq_text: b.document.text }, b, job, refs, saveJob);
        validate(stage, x); assertReferences(stage, x); b.scope = x; b.status = 'Scope review'; return x;
    }
    const input = { scope: b.scope, ...(stage === 'bom' ? { catalog, engineering_rules: {} } : { bom: b.results.bom }), ...(stage === 'architecture' ? { architecture_rules: {} } : {}), ...(stage === 'services' ? { architecture: b.results.architecture, service_rules: rules } : {}) };
    let x = await agent(stage, input, b, job, refs, saveJob);
    if (b.mode === 'demo' && stage === 'bom') {
        // Reuse sample fixture only for known sample requirements; honor edited quantities.
        x.items = x.items.filter(i => b.scope.requirements.some(r => i.requirement_ids.includes(r.id)));
        for (const i of x.items) { const q = b.scope.quantities.find(q => q.requirement_ids.includes(i.requirement_ids[0])); if (!q || !Number.isInteger(q.value) || q.value < 1) throw Error('Demo BOM needs positive integer quantities for sample equipment.'); i.quantity = q.value; i.quantity_basis = 'Confirmed sample scope quantity: ' + q.value; }
        const covered = new Set(x.items.flatMap(i => i.requirement_ids)); x.gaps = b.scope.requirements.filter(r => r.mandatory && ['hardware', 'software', 'network', 'cybersecurity', 'interface'].includes(r.category) && !covered.has(r.id)).map(r => ({ requirement_id: r.id, reason: 'No sample mapping; use Live AI for custom requirements.' }));
    }
    if (b.mode === 'demo' && stage === 'architecture') { x.nodes = x.nodes.filter(n => n.type === 'external' ? b.scope.interfaces.includes(n.label) : b.results.bom.items.some(i => i.id === n.bom_item_id)); for (const n of x.nodes) if (n.bom_item_id) n.quantity = b.results.bom.items.find(i => i.id === n.bom_item_id).quantity; x.edges = x.edges.filter(e => x.nodes.some(n => n.id === e.source) && x.nodes.some(n => n.id === e.target)); }
    validate(stage, x); assertReferences(stage, x, b.scope, b.results.bom);
    if (stage === 'bom') { b.results.bom = x; b.results.priced_bom = priceBOM(x, catalog); }
    if (stage === 'architecture') b.results.architecture = x;
    if (stage === 'services') { b.results.service_plan = x; b.results.services = calculateServices(x, b.scope, b.results.bom, catalog, rules); b.status = 'Review'; }
    return x;
}
