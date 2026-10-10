import assert from 'node:assert/strict';
import { cornerScale, layoutBounds, scaleAt, layoutWarnings, annotateLayoutKeys } from './mgLayoutGeometry';
import { mgLayoutActions } from './mgLayoutActions';
import { effectivePreviewTransform } from '../components/preview/previewTransform';
import { historyReduce } from './reducerHistory';
import { buildCommands } from './storeCommandBuilder';
import { loadLayoutDefaults } from '../xmt/mgLayoutDefaults';
import { execVisualCompositionTool } from '../agent/tools/visual-composition-tools';
import type { AgentContext } from '../agent/context';
import type { ProjectDoc, TimelineItem } from './types';
import type { Tpl } from '../types';
const close = (a:number,b:number) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`);
const box = {x:.15,y:.7,w:.4,h:.12}, start = {x:7,y:-10,scale:.8};
for (const [w,h] of [[832,468],[416,234],[270,480]]) {
  const before = layoutBounds(box,start), center = {x:box.x+box.w/2,y:box.y+box.h/2};
  const after = layoutBounds(box,scaleAt(start,1.6,center));
  close((before.x+before.w/2)*w,(after.x+after.w/2)*w);
  close((before.y+before.h/2)*h,(after.y+after.h/2)*h);
  for (let corner=0;corner<4;corner++) {
    const raw = [{x:box.x,y:box.y},{x:box.x+box.w,y:box.y},{x:box.x+box.w,y:box.y+box.h},{x:box.x,y:box.y+box.h}];
    const opposite=raw[(corner+2)%4], origin=layoutBounds({...opposite,w:0,h:0},start);
    const point={x:origin.x+(raw[corner].x-opposite.x)*1.3,y:origin.y+(raw[corner].y-opposite.y)*1.3};
    const scaled=cornerScale(start,box,corner,{x:point.x*w/w,y:point.y*h/h});
    close(scaled.scale,1.3);
    const stable=layoutBounds({...opposite,w:0,h:0},scaled); close(origin.x,stable.x);close(origin.y,stable.y);
  }
}
assert.equal(layoutWarnings(box,{x:0,y:80,scale:1}).length,2);
const group:TimelineItem={id:'group',kind:'sequence',timelineId:'child',track:'V1',startFrame:0,durationInFrames:90,
  name:'组合',transform:{x:20,y:10,scale:1},props:{_xmt:{layoutTemplateKey:'xmt-composition-node-v1#table'}},
  keyframes:{scale:[{frame:0,value:.8},{frame:30,value:1}],x:[{frame:0,value:15},{frame:30,value:20}],opacity:[{frame:0,value:0},{frame:30,value:1}]}};
const timeline={id:'root',name:'根',order:0,fps:30,width:1920,height:1080,items:[group],selectedId:'group',trackOrder:['V1'],tracks:{V1:{kind:'video' as const}}};
const initial:ProjectDoc={version:3,activeTimelineId:'root',timelines:[timeline,{...timeline,id:'child',selectedId:null,items:[{id:'solid',kind:'solid',name:'底',track:'V1',startFrame:0,durationInFrames:90,props:{color:'#333'}}]}],assets:[],mediaFolders:[]};
let history={past:[],present:initial,future:[]} as Parameters<typeof historyReduce>[0];
history=historyReduce(history,{type:'history.beginGesture'});
history=historyReduce(history,{type:'batch',actions:mgLayoutActions(timeline,'group',{x:24,y:-2,scale:.6,scaleX:.6,scaleY:.6})});
const moved=history.present.timelines[0].items[0];
assert.deepEqual(moved.keyframes?.x?.map(k=>k.value),[21,24]);
assert.deepEqual(moved.keyframes?.opacity,group.keyframes?.opacity);
close(effectivePreviewTransform(moved,0).scale,.48);
close(effectivePreviewTransform(moved,30).scale,.6);
history=historyReduce(history,{type:'history.endGesture'});
const saved=JSON.parse(JSON.stringify(history.present));
assert.deepEqual(historyReduce(history,{type:'undo'}).present,initial);
assert.deepEqual(JSON.parse(JSON.stringify(historyReduce(historyReduce(history,{type:'undo'}),{type:'redo'}).present)),saved);
const marks={...group,id:'marks',kind:'motion-graphic' as const,templateId:'xmt-still-marks',props:{_xmt:{stillId:'photo'}},keyframes:undefined};
const image={...group,id:'image',kind:'image' as const,transform:{x:25,y:10,scale:1},props:{_xmt:{stillId:'photo'}},keyframes:undefined};
const linked={...timeline,items:[marks,image]};
const linkedActions=mgLayoutActions(linked,'marks',{x:27,scale:2});
assert.equal(linkedActions.filter(a=>a.type==='setTransform').length,2);
assert.deepEqual(linkedActions.find(a=>a.type==='setTransform' && a.id==='image'),{type:'setTransform',id:'image',patch:{x:37,y:10,scale:2,scaleX:undefined,scaleY:undefined}});
let document=initial;
globalThis.fetch=async () => new Response(JSON.stringify({success:true,data:{revision:1,layouts:{'xmt-ov-score-bug':{landscape:{x:12,y:-8,scale:.6}}}}}));
await loadLayoutDefaults();
const commands=buildCommands(action => {document=historyReduce({past:[],present:document,future:[]},action).present;},()=>document);
commands.addMotionGraphic({id:'xmt-ov-score-bug',name:'比分',width:1920,height:1080,durationInFrames:90,props:{},code:'',fps:30,category:'',propSchema:[],thumb:null} as Tpl);
assert.deepEqual(document.timelines[0].items[1].transform,{x:12,y:-8,scale:.6});
assert.deepEqual(annotateLayoutKeys(saved).timelines[0].items[0].transform,JSON.parse(JSON.stringify(moved.transform)));
// A wide component window inside a portrait project uses the owner's defaults.
document={...initial,activeTimelineId:'root',timelines:[{...timeline,width:1080,height:1920,items:[],selectedId:null}]};
Object.assign(globalThis,{window:{__XMT_EDITOR__:{csrfToken:'',projectUrl:'/qa/project'}}});
globalThis.fetch=async () => new Response(JSON.stringify({success:true,data:{revision:2,layouts:{
  'xmt-composition-node-v1#chapter':{landscape:{x:111,y:0,scale:1},portrait:{x:12,y:-8,scale:.6}}
}}}));
const compositionResult=await execVisualCompositionTool('edit_visual_composition',{
  action:'create',composition_id:'aspect',template_id:'xmt-composition-node-v1',
  composition:{version:1,id:'aspect',start_ms:0,end_ms:3000,rect:{x:0,y:0,w:1,h:.1}},
  nodes:[{id:'heading',component:'chapter',rect:{x:0,y:0,w:1,h:1},style:{font:'Arial',font_size:.03},parts:[{
    id:'panel',shape:'panel',rect:{x:0,y:0,w:1,h:1},style:{fontFamily:'Arial',fontSize:32},content:{text:'长标题'}
  }]}]
},{commands:{applyDoc:(next:ProjectDoc)=>{document=next;}},getDoc:()=>document,
   templates:[{id:'xmt-composition-node-v1',code:'',props:{}}]} as unknown as AgentContext);
assert.equal(compositionResult.ok,true,JSON.stringify(compositionResult));
assert.deepEqual(document.timelines.flatMap(t=>t.items).find(i=>i.id==='vc_aspect_heading_instance')?.transform,{x:12,y:-8,scale:.6});
Reflect.deleteProperty(globalThis,'window');
console.log('MG geometry, linked curves, history, refresh and new insertion passed');
