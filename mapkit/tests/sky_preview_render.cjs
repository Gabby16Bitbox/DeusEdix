const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
// node tests/sky_preview_render.cjs (Playwright + Edge, or set PLAYWRIGHT_MODULE).
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
  const T=await import('three'),{createSkyPreview}=await import('/editor/static/sky-preview.js'),{skyUV}=await import('/editor/static/sky-background.js');
  const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(640,480);document.body.appendChild(renderer.domElement);
  const scene=new T.Scene();scene.background=new T.Color(0);
  const cam=new T.PerspectiveCamera(60,4/3,1,10000),target=new T.WebGLRenderTarget(129,129),pixel=new Uint8Array(4);
  const sky=createSkyPreview({THREE:T,scene,storage:{getItem:()=>null,setItem:()=>{}}});
  const sample=(camera=cam)=>{renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,64,64,1,1,pixel);return [...pixel];};
  function recipe(base){const image=new ImageData(64,64);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;image.data.set([x*4,y*4,base,255],i);}return {image,tile:2048,width:64,height:64};}
  const source={look:[recipe(20),recipe(120),recipe(220)],background:{height:-12.5,scale:70,horizontal:15},field:null,layer:{high:100,tile:200,speed:0,dir:[1,0]}};
  sky.setSource(source);
  const faces=[];
  for(const [f,d] of [[0,[-1,.17,.25]],[1,[1,.17,.25]],[2,[.17,-1,.25]],[3,[.17,1,.25]],[4,[.17,.25,-1]],[5,[.17,.25,1]]]){
    cam.position.set(0,0,0);cam.lookAt(d[0],d[2],d[1]);const slot=source.look[f<4?0:f===4?2:1],uv=skyUV(d.map(x=>x*1024),f,slot,source.background);
    const expected=uv.map(v=>((v%1+1)%1)*256-2);faces.push({face:f,pixel:sample(),expected:[...expected,slot.image.data[2]]});
  }
  cam.position.set(0,0,0);cam.lookAt(1,.25,.17);const before=sample();
  cam.position.set(310,290,-180);cam.lookAt(311,290.25,-179.83);const afterMove=sample();
  const beforeSlide=sample();sky.setSource({...source,background:{...source.background,height:15}});const afterSlide=sample();
  sky.setEnabled(false);const disabled=sample();sky.setEnabled(true);const restored=sample();
  const rc=new T.Raycaster(cam.position,new T.Vector3(1,.25,.17).normalize());const hits=rc.intersectObjects(scene.children,true).length;
  const ortho=new T.OrthographicCamera(-2,2,2,-2,.1,100);ortho.position.set(0,0,10);ortho.lookAt(0,0,0);const orthographic=sample(ortho);const afterOrtho=sample();
  // A fake-backdrop opening hides geometry beyond it but never covers geometry in front.
  cam.position.set(0,0,0);cam.lookAt(0,0,-1);
  const portal=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshBasicMaterial({color:0,side:T.DoubleSide}));portal.position.z=-10;scene.add(portal);sky.bindSurface(portal,false);
  const portalSky=sample();const object=new T.Mesh(new T.PlaneGeometry(80,80),new T.MeshBasicMaterial({color:0xff0000,side:T.DoubleSide}));scene.add(object);object.position.z=-20;const behind=sample();object.position.z=-5;const inFront=sample();
  sky.setEnabled(false);object.visible=false;const portalOff=sample();sky.setEnabled(true);sky.suspend(true);const suspended=sample();sky.suspend(false);
  const texturesBefore=renderer.info.memory.textures;for(let i=0;i<100;i++){sky.setSource({...source,background:{height:i/10}});sample();}const texturesAfter=renderer.info.memory.textures;
  const field=new Float32Array(128*128*3);field.fill(80);sky.setSource({...source,field,layer:{...source.layer,speed:10}});const animating=sky.animating;sky.setEnabled(false);const idleDisabled=sky.animating;sky.setEnabled(true);
  // Unload disposes all sky/cloud textures and restores original portal state.
  sky.clearSurfaces();sky.setSource(null);sample();const unloadedTextures=renderer.info.memory.textures;const unloadedReady=sky.ready;
  const result={faces,before,afterMove,beforeSlide,afterSlide,disabled,restored,hits,orthographic,afterOrtho,portalSky,behind,inFront,portalOff,suspended,texturesBefore,texturesAfter,animating,idleDisabled,unloadedTextures,unloadedReady};
  sky.dispose();target.dispose();renderer.dispose();return result;
 });
 for(const f of result.faces)f.pixel.slice(0,3).forEach((v,i)=>assert.ok(Math.abs(v-f.expected[i])<2,JSON.stringify(f)));
 assert.deepEqual(result.before,result.afterMove);assert.notDeepEqual(result.beforeSlide,result.afterSlide);
 assert.deepEqual(result.disabled,[0,0,0,255]);assert.deepEqual(result.afterSlide,result.restored);assert.equal(result.hits,0);
 assert.deepEqual(result.orthographic,[0,0,0,255]);assert.deepEqual(result.afterOrtho,result.restored);
 assert.deepEqual(result.behind,result.portalSky);assert.deepEqual(result.inFront,[255,0,0,255]);assert.deepEqual(result.portalOff,[0,0,0,255]);assert.deepEqual(result.suspended,[0,0,0,255]);
 assert.equal(result.texturesBefore,result.texturesAfter);assert.equal(result.animating,true);assert.equal(result.idleDisabled,false);assert.equal(result.unloadedTextures,1);assert.equal(result.unloadedReady,false);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(root,'render-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,...result},null,2));
} finally {await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
