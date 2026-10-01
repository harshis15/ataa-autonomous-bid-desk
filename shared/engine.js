const round=n=>Math.round(n*100)/100;
export function rankProjects(scope,projects){
 const norm=v=>String(v??'').trim().toLowerCase();
 const cabinets=scope.quantities.find(q=>norm(q.item)==='control cabinets')?.value;
 return projects.map(p=>{
 const criteria=[['Industry',scope.project.industry,p.industry,25],['Country',scope.project.country,p.country,20],['System',scope.system.type,p.system,25],['Architecture',scope.system.architecture,p.architecture,15]].map(([label,current,reference,weight])=>({label,current,reference,weight,points:current&&norm(current)===norm(reference)?weight:0}));
 criteria.push({label:'Cabinet count',current:cabinets??null,reference:p.cabinets,weight:10,points:cabinets!=null?round(10*Math.max(0,1-Math.abs(cabinets-p.cabinets)/Math.max(cabinets,p.cabinets,1))):0});
 const matched=scope.services.filter(s=>p.services.some(t=>norm(s)===norm(t))).length;
 criteria.push({label:'Service overlap',current:scope.services.join(', '),reference:p.services.join(', '),weight:5,points:scope.services.length?round(5*matched/scope.services.length):0});
 return {...p,criteria,score:round(criteria.reduce((s,c)=>s+c.points,0))};
 }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}
export function baselineDelta(scope,p){
 const current=scope.quantities.find(q=>q.item.toLowerCase()==='control cabinets')?.value??null;
 return [['Control cabinets',p.cabinets,current,'each'],['Support',p.support_years,scope.constraints.support_years,'years'],['Delivery',p.delivery_weeks,scope.constraints.delivery_weeks,'weeks']].map(([label,reference,current,unit])=>({label,reference,current,unit,delta:current===null?null:current-reference}));
}
export function priceBOM(bom,catalog){
 return bom.items.map(i=>{const p=catalog.find(p=>p.part_number===i.part_number);if(!p)throw Error(`Unknown catalog part: ${i.part_number}`);return {...i,...{description:p.description,category:p.category,unit_price:p.unit_price,currency:p.currency,line_total:round(p.unit_price*i.quantity)}}});
}
export function requiredRuleIds(scope,rules){return rules.filter(r=>scope.services.some(s=>s.toLowerCase()===r.service.toLowerCase())).map(r=>r.id);}
export function calculateServices(plan,scope,bom,catalog,rules){
 const expected=requiredRuleIds(scope,rules);const unique=new Set(plan.rule_ids);
 if(unique.size!==plan.rule_ids.length)throw Error('Duplicate service rule selection.');
 for(const id of unique)if(!rules.some(r=>r.id===id))throw Error(`Unknown service rule: ${id}`);
 for(const id of expected)if(!unique.has(id))throw Error(`Required service rule missing: ${id}`);
 for(const id of unique)if(!expected.includes(id))throw Error(`Service rule is outside requested scope: ${id}`);
 const items=priceBOM(bom,catalog),lines=[],unresolved=[];
 for(const rule of rules.filter(r=>unique.has(r.id)&&r.driver!=='percentage')){
 let quantity=1;
 if(rule.driver==='category')quantity=items.filter(i=>i.category===rule.product_category).reduce((s,i)=>s+i.quantity,0);
 if(rule.driver==='categories')quantity=items.filter(i=>rule.product_categories.includes(i.category)).reduce((s,i)=>s+i.quantity,0);
 if(rule.driver==='scope_quantity')quantity=scope.quantities.find(q=>q.item.toLowerCase()===rule.quantity_item.toLowerCase())?.value??null;
 if(quantity===null){unresolved.push({activity:rule.activity,reason:`Missing ${rule.quantity_item}`});continue;}
 if(quantity===0)continue;
 lines.push({id:rule.id,activity:rule.activity,category:rule.category,quantity,rate:rule.rate,calculation:`${quantity} × ${rule.rate} h`,hours:round(quantity*rule.rate)});
 }
 for(const rule of rules.filter(r=>unique.has(r.id)&&r.driver==='percentage')){
 const base=round(lines.filter(l=>l.driver!=='percentage').reduce((s,l)=>s+l.hours,0));
 lines.push({id:rule.id,activity:rule.activity,category:rule.category,driver:'percentage',quantity:base,rate:rule.rate,calculation:`${rule.rate}% × ${base} h`,hours:round(base*rule.rate/100)});
 }
 for(const service of scope.services)if(!rules.some(r=>r.service.toLowerCase()===service.toLowerCase()))unresolved.push({activity:service,reason:'No service-hour rule supplied. Excluded from total.'});
 return {lines,total_hours:round(lines.reduce((s,l)=>s+l.hours,0)),unresolved,notes:plan.notes,status:unresolved.length?'provisional':'complete'};
}
export function assertReferences(stage,result,scope,bom){
 const unique=(xs,label)=>{if(new Set(xs).size!==xs.length)throw Error(`Duplicate ${label} IDs.`);};
 const knownReq=new Set(scope?.requirements.map(r=>r.id)||[]);
 if(stage==='scope'){
 unique(result.requirements.map(r=>r.id),'requirement');unique(result.quantities.map(r=>r.id),'quantity');unique(result.clarifications.map(r=>r.id),'clarification');
 if(!result.requirements.length)throw Error('No requirements extracted. Check the RFQ.');
 for(const q of result.quantities)for(const id of q.requirement_ids)if(!result.requirements.some(r=>r.id===id))throw Error(`Unknown quantity requirement: ${id}`);
 }
 if(stage==='bom'){
 unique(result.items.map(i=>i.id),'BOM');
 if(!result.items.length)throw Error('No catalog products were selected. Review scope or catalog gaps.');
 for(const i of result.items){if(!i.requirement_ids.length)throw Error('BOM item lacks a requirement reference.');for(const id of i.requirement_ids)if(!knownReq.has(id))throw Error(`Unknown requirement ${id}`);}
 for(const gap of result.gaps)if(!knownReq.has(gap.requirement_id))throw Error('Unknown gap requirement.');
 }
 if(stage==='architecture'){
 unique(result.nodes.map(n=>n.id),'node');unique(result.edges.map(e=>e.id),'edge');
 const ids=new Set(result.nodes.map(n=>n.id)),allocated={};
 if(!ids.size)throw Error('Architecture is empty.');
 for(const n of result.nodes){
 if(n.type==='external'){if(n.bom_item_id!==null||!scope.interfaces.some(x=>x.toLowerCase()===n.label.toLowerCase()))throw Error('External node must exactly match a scope interface.');continue;}
 const item=bom.items.find(i=>i.id===n.bom_item_id);if(!item)throw Error(`Architecture node ${n.id} references unknown BOM item.`);
 allocated[item.id]=(allocated[item.id]||0)+n.quantity;if(allocated[item.id]>item.quantity)throw Error(`Architecture over-allocates ${item.id}.`);
 }
 for(const e of result.edges)if(!ids.has(e.source)||!ids.has(e.target))throw Error('Architecture edge references missing node.');
 }
 return result;
}
