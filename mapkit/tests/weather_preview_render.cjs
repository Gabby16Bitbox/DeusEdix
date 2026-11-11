const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
// node tests/weather_preview_render.cjs (Playwright + Edge, or PLAYWRIGHT_MODULE).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..'),errors=[];
const server=http.createServer((req,res)=>{
 if(req.url==='/favicon.ico'){res.writeHead(204);return res.end();}
 if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<html><body style="margin:0"><script type="importmap">{"imports":{"three":"/tests/three.mjs"}}</script></body></html>');}
 const file=path.resolve(root,'.'+req.url.split('?')[0]);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(file));
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {const page=await browser.newPage({viewport:{width:640,height:480}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const result=await page.evaluate(async()=>{
  const T=await import('three'),{createWeatherPreview,weatherKind,weatherSettings}=await import('/editor/static/weather-preview.js');
  const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(640,480);document.body.appendChild(renderer.domElement);
  const scene=new T.Scene();scene.background=new T.Color(0);const camera=new T.PerspectiveCamera(75,4/3,2,10000);camera.position.set(0,100,0);camera.lookAt(0,100,-1000);
  let obstacles=[];const weather=createWeatherPreview({THREE:T,scene,camera,obstacles:()=>obstacles});
  const actor={cls:'Precipitation.PrecipitationZone'},config=weatherSettings(actor,()=>null,weatherKind(actor));
  const source={name:'Rain0',settings:config,revision:1},group=scene.getObjectByName('Weather preview'),rain=group.children[0],snow=group.children[1];
  const settle=()=>{for(let i=0;i<20;i++)weather.step(1/60,source);};
  const lit=cam=>{renderer.render(scene,cam||camera);const gl=renderer.getContext(),pix=new Uint8Array(640*480*4);gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,pix);let n=0,hash=0;for(let i=0;i<pix.length;i+=4)if(pix[i]+pix[i+1]+pix[i+2]){n++;hash=(hash+i*pix[i])>>>0;}return {n,hash};};
  settle();const active=weather.info,frame1=lit(),positions=Array.from(rain.geometry.attributes.position.array.slice(0,60));weather.step(.1,source);const frame2=lit(),moved=JSON.stringify(positions)!==JSON.stringify(Array.from(rain.geometry.attributes.position.array.slice(0,60)));
  const rainHits=new T.Raycaster(camera.position,new T.Vector3(0,0,-1)).intersectObjects(group.children,true).length;
  const ortho=new T.OrthographicCamera(-1000,1000,750,-750,1,10000);ortho.position.copy(camera.position);ortho.lookAt(0,100,-1000);const orthographic=lit(ortho);
  weather.setPaused('Rain0',true);weather.step(.1,source);const paused=lit(),pausedActive=weather.active;weather.setPaused('Rain0',false);settle();
  const count7=weather.info.count;source.settings={...config,density:14};settle();const count14=weather.info.count;source.settings={...config,density:255};settle();const countMax=weather.info.count;
  source.settings={...config,density:0};weather.step(.1,source);const densityZero=lit();source.settings={...config,falling:false};weather.step(.1,source);const fallingOff=lit();source.settings=config;
  weather.step(.1,null);const deselected=lit();weather.step(.1,source,true);const suspended=lit();
  // An opaque slab at Y=150 clips every streak above it, even when the camera is below.
  const roof=new T.Mesh(new T.BoxGeometry(5000,20,5000),new T.MeshBasicMaterial({side:T.DoubleSide}));roof.position.y=150;roof.updateMatrixWorld(true);obstacles=[roof];source.revision++;settle();
  const ys=()=>{const a=rain.geometry.attributes.position.array,out=[];for(let i=1;i<rain.geometry.drawRange.count*3;i+=3)out.push(a[i]);return out;};
  const roofMinY=Math.min(...ys());roof.position.y=1500;roof.updateMatrixWorld(true);source.revision++;settle();const highRoof=weather.info.rendered;
  obstacles=[];source.settings={...config,wind:[250,0,-100]};source.revision++;settle();const a=rain.geometry.attributes.position.array,windDelta=[a[3]-a[0],a[4]-a[1],a[5]-a[2]];
  source.settings={...config,kind:'snow'};settle();const snowFrame=lit(),snowCount=snow.geometry.drawRange.count,snowHits=new T.Raycaster(camera.position,new T.Vector3(0,0,-1)).intersectObjects(group.children,true).length;
  camera.position.set(10000,5000,20000);source.settings=config;settle();const cameraMinY=Math.min(...ys()),cameraMaxX=Math.max(...Array.from(rain.geometry.attributes.position.array.slice(0,rain.geometry.drawRange.count*3)).filter((_,i)=>i%3===0));
  lit();const memBefore={...renderer.info.memory};for(let i=0;i<60;i++){weather.setPaused('Rain0',i%2===0);weather.step(.016,source);lit();}const memAfter={...renderer.info.memory};
  weather.clear();const cleared=weather.info;weather.dispose();lit();const disposed=renderer.info.memory.geometries;
  const parsing={snow:weatherKind({cls:'CustomSnow'},['CustomSnow','SnowZone','PrecipitationZone']),other:weatherKind({cls:'ZoneInfo'}),zeros:weatherSettings(actor,(_,k)=>k==='PrecipDensity'?'0':k==='bWeatherActive'?'False':null,'rain'),wind:weatherSettings(actor,(_,k)=>k==='Wind'?'(X=100,Y=-20,Z=5)':null,'rain').wind};
  roof.geometry.dispose();roof.material.dispose();renderer.dispose();return {active,frame1,frame2,moved,rainHits,orthographic,paused,pausedActive,count7,count14,countMax,densityZero,fallingOff,deselected,suspended,roofMinY,highRoof,windDelta,snowFrame,snowCount,snowHits,cameraMinY,cameraMaxX,memBefore,memAfter,cleared,disposed,parsing};
 });
 assert.equal(result.active.active,true);assert.ok(result.frame1.n>50);assert.notDeepEqual(result.frame1,result.frame2);assert.ok(result.moved);assert.equal(result.rainHits,0);assert.equal(result.snowHits,0);
 for(const k of ['orthographic','paused','densityZero','fallingOff','deselected','suspended'])assert.equal(result[k].n,0,k);
 assert.equal(result.pausedActive,false);assert.equal(result.count14,result.count7*2);assert.ok(result.countMax<=1800);assert.ok(result.roofMinY>=160);assert.equal(result.highRoof,0);
 assert.ok(result.windDelta[0]>0&&result.windDelta[1]<0&&result.windDelta[2]<0);assert.ok(result.snowFrame.n>50);assert.ok(result.snowCount>0);assert.ok(result.cameraMinY>3400);assert.ok(result.cameraMaxX>10000);
 assert.deepEqual(result.memBefore,result.memAfter);assert.equal(result.disposed,0);assert.equal(result.cleared.active,false);assert.equal(result.parsing.snow,'snow');assert.equal(result.parsing.other,null);assert.equal(result.parsing.zeros.density,0);assert.equal(result.parsing.zeros.falling,false);assert.deepEqual(result.parsing.wind,[100,5,-20]);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(root,'render-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,...result},null,2));
} finally {await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
