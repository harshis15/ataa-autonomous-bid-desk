const str={type:'string'}, num={type:'number',minimum:0}, nullable={type:['string','null']};
const arr=items=>({type:'array',items});
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const issue=obj({id:str,question:str,severity:{enum:['low','medium','high']},resolved:{type:'boolean'},answer:nullable});
export const schemas={
 scope:obj({project:obj({customer:nullable,name:nullable,country:nullable,industry:nullable}),system:obj({type:nullable,architecture:nullable}),requirements:arr(obj({id:str,text:str,category:str,mandatory:{type:'boolean'},source:str})),quantities:arr(obj({id:str,item:str,value:{type:['number','null'],minimum:0},unit:str,requirement_ids:arr(str)})),services:arr(str),constraints:obj({delivery_weeks:{type:['number','null'],minimum:0},support_years:{type:['number','null'],minimum:0},currency:nullable}),interfaces:arr(str),standards:arr(str),assumptions:arr(str),clarifications:arr(issue)}),
 bom:obj({items:arr(obj({id:str,part_number:str,quantity:{type:'integer',minimum:1},requirement_ids:arr(str),reason:str,quantity_basis:str})),gaps:arr(obj({requirement_id:str,reason:str})),assumptions:arr(str)}),
 architecture:obj({title:str,nodes:arr(obj({id:str,label:str,type:{enum:['server','workstation','network','controller','io','firewall','storage','software','cabinet','external']},bom_item_id:nullable,quantity:{type:'integer',minimum:1},layer:{type:'integer',minimum:0,maximum:5},reason:str})),edges:arr(obj({id:str,source:str,target:str,label:str,protocol:nullable,basis:str})),assumptions:arr(str),issues:arr(str)}),
 services:obj({rule_ids:arr(str),notes:arr(str)})
};
export const stageLabels={scope:'Scope Agent',bom:'BOM Agent',architecture:'Plant Architect',services:'Service Estimator'};
