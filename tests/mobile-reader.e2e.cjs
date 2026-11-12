const {spawn} = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-preview-'))
const chrome = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(file => file && fs.existsSync(file))
if (!chrome) throw Error('Install Chrome or set CHROME_BIN before running mobile regression tests.')
const proc = spawn(chrome, ['--headless=new','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'], {stdio:'ignore',windowsHide:true})
const wait = (ms=100) => new Promise(r=>setTimeout(r,ms))
async function until(fn) {
  for (let i=0;i<90;i++) { try { const r = await fn(); if(r) return r } catch {} await wait() }
  throw Error('Wait timed out: '+fn)
}
async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  let id=0
  const pending=new Map()
  const errors=[]
  const events=new Map()
  ws.onmessage=({data})=>{
    const msg=JSON.parse(data)
    if(events.has(msg.method)) events.get(msg.method)(msg.params)
    if(msg.method==='Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
    if(msg.id) { const handlers=pending.get(msg.id); pending.delete(msg.id); msg.error ? handlers[1](Error(msg.error.message)) : handlers[0](msg.result) }
  }
  const call = (method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,[resolve,reject]);ws.send(JSON.stringify({id,method,params}))})
  const run=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true})
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description)
    return result.result.value
  }
  await call('Runtime.enable')
  return {ws,call,run,errors,events}
}

;(async()=>{
  const [port] = await until(()=>fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split(/\s+/))
  const tabs = await (await fetch('http://localhost:'+port+'/json/list')).json()
  const {ws,call,run,errors}=await connect(tabs.find(t=>t.type==='page').webSocketDebuggerUrl)
  global.debugRun=run;global.debugCall=call
  const click=selector=>run('document.querySelector('+JSON.stringify(selector)+').click()')
  const setup=()=>{
    localStorage.clear()
    const scenario=new URLSearchParams(location.search).get('scenario')||'table'
    const first='saf:/fixtures/01-阅读与留白.md',second='saf:/fixtures/02-下一章.md'
    const filler=Array.from({length:24},(_,i)=>'## 第 '+(i+1)+' 节\n\n'+'留一点时间给阅读。让眼睛随着文字慢下来，把注意力交还给内容。'.repeat(6)).join('\n\n')
    const columns=Array.from({length:24},(_,i)=>'列'+i)
    const wide='|'+columns.join('|')+'|\n|'+columns.map(()=> '---').join('|')+'|\n|'+columns.map(()=> '数据内容').join('|')+'|'
    const fixtures={
      table:'| 项目 | 状态 |\n| --- | --- |\n| 阅读 | 从容 |\n\n'+filler,
      external:'[外部站点](https://example.com/folio)\n\n'+filler,
      link:'[进入下一章](02-下一章.md)\n\n'+filler,
      plain:'开始阅读，在这里左右滑动。\n\n'+filler,
      code:'~~~\nconst reading = true\n~~~\n\n'+filler,
      wide:wide+'\n\n'+filler,
      image:'![留白](cover.svg)\n\n'+filler,
      boundary:'# 系列首篇\n\n简短的第一篇。',
      design:'# 留一点时间给阅读\n\n不必急着抵达下一页。让眼睛沿着文字慢下来，在字里行间，找到自己的节奏。\n\n> 好的阅读体验，应该让工具退后，让内容留在眼前。\n\n## 从一篇文档开始\n\n'+filler,
    }
    window.calls=[];window.interactions=0;window.remoteGeneration=1;window.remoteFail=false;window.cloneGeneration=1;window.cloneFail=false;window.cloneConfig=null;window.cloneManaged=true
    localStorage.setItem('folio:roots',JSON.stringify([{path:'saf:/fixtures',directory:true,label:'阅读笔记'}]))
    localStorage.setItem('folio:expanded',JSON.stringify(['saf:/fixtures']))
    localStorage.setItem('folio:layout:main',JSON.stringify({groups:[{id:'g',active:'t',tabs:[{id:'t',path:first}]}],focused:'g',axis:'row',ratio:50}))
    localStorage.setItem('folio:settings',JSON.stringify({readingMode:'paged',pageAnimation:'none',font:17,line:1.8,width:700,theme:'light',tint:'',openMode:'current',mobilePadding:24,swipePaging:true,tapPaging:true}))
    const data=path=>path.endsWith('.svg')?'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80"><rect width="320" height="80" fill="#087987"/></svg>':path===second?'# 下一章\n\n这是系列中的第二篇。':fixtures[scenario]
    window.isTauri=true
    window.__TAURI_INTERNALS__={
      metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,
      invoke:async(cmd,args)=>{
        calls.push({cmd,args})
        const desktop=new URLSearchParams(location.search).has('desktop')
        const clonePath=desktop?'C:/Folio/cloned':'saf:/cloned'
        if(cmd==='local_clone_info')return window.cloneConfig && args.path.startsWith(clonePath)?{path:clonePath,source:cloneConfig,directory:'',managed:window.cloneManaged}:null
        if(cmd==='local_clone_adopt') { window.cloneManaged=true; return null }
        if(cmd==='local_clone_update') { if(window.cloneFail)throw '模拟下载失败，原副本保留'; window.cloneGeneration++; window.cloneConfig=args.source; return clonePath }
        if(cmd==='remote_clone') { window.cloneConfig={provider:args.provider,url:args.url,branch:args.branch}; return clonePath }
        if(cmd==='remote_resolve') { if(window.remoteFail)throw '模拟网络中断'; return {commit:'commit-'+window.remoteGeneration,tree:null} }
        if(cmd==='remote_list')return [{name:'README.md',directory:false},...(window.remoteGeneration>1?[{name:'NEW.md',directory:false}]:[])]
        if(cmd==='remote_read')return new TextEncoder().encode('# 远程版本 '+args.commit+'\n\n更新后的正文').buffer
        if(cmd==='runtime_platform')return new URLSearchParams(location.search).has('desktop')?'windows':'android'
        if(cmd==='mobile_request'){
          if(args.command==='cloneInfo')return window.cloneConfig && args.payload.path.startsWith(clonePath)?{path:clonePath,source:cloneConfig,directory:'',managed:window.cloneManaged}:null
          if(args.command==='cloneStart') { if(window.cloneFail)throw '模拟下载失败，原副本保留'; if(args.payload.path)window.cloneGeneration++;window.cloneConfig={provider:args.payload.provider,url:args.payload.url,branch:args.payload.branch}; return {path:clonePath} }
          if(args.command==='cloneStatus')return {phase:'下载新副本',completed:0,total:0}
          if(args.command==='read' && args.payload.path.startsWith(clonePath))return {data:btoa(String.fromCharCode(...new TextEncoder().encode('# 本地版本 '+cloneGeneration+'\n\n本地离线正文')))}
          if(args.command==='list' && args.payload.path.startsWith(clonePath))return {entries:[{path:clonePath+'/README.md',directory:false}]}

          if(args.command==='read')return {data:btoa(String.fromCharCode(...new TextEncoder().encode(data(args.payload.path))))}
          if(args.command==='list')return {entries:[{path:first,directory:false},{path:second,directory:false}]}
          if(args.command==='choose')return {entries:[{path:'saf:/fixtures',directory:true,label:'阅读笔记'}]}
        }
        if(cmd==='plugin:dialog|open')return 'C:/Folio'
        if(cmd==='plugin:fs|read_file' && args.path.startsWith(clonePath))return new TextEncoder().encode('# 本地版本 '+cloneGeneration+'\n\n本地离线正文').buffer
        if(cmd==='plugin:fs|read_dir' && args.path.startsWith(clonePath))return [{name:'README.md',isFile:true,isDirectory:false}]
        if(cmd==='plugin:fs|read_file')return new TextEncoder().encode(data(args.path)).buffer
        if(cmd==='plugin:fs|read_dir')return [{name:'01-阅读与留白.md',isFile:true,isDirectory:false},{name:'02-下一章.md',isFile:true,isDirectory:false}]
        if(cmd==='plugin:window|get_all_windows')return ['main']
        return 1
      }
    }
  }
  await call('Page.enable')
  await call('Page.addScriptToEvaluateOnNewDocument',{source:'('+setup.toString()+')()'})
  const metrics=async(width,height)=>call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true,screenOrientation:{type:width>height?'landscapePrimary':'portraitPrimary',angle:width>height?90:0}})
  await metrics(390,844)
  await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2})
  const page=()=>run("Number(document.querySelector('.page-number')?.textContent.split('/')[0])")
  const navigate=async scenario=>{
    // Reset Chrome's synthetic multi-touch stream between independent documents.
    await call('Emulation.setTouchEmulationEnabled',{enabled:false})
    await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2})
    await call('Page.navigate',{url:(process.env.FOLIO_TEST_URL||'http://127.0.0.1:1422/')+'?scenario='+scenario})
    await until(()=>run("!!document.querySelector('.markdown') && document.querySelector('.page-number')?.textContent.includes('/')"))
    await wait(150)
    await run("window.pointerLog=[]; for(const name of ['pointerdown','pointerup','pointercancel']) document.addEventListener(name,e=>pointerLog.push({name,tag:e.target.tagName,primary:e.isPrimary,x:e.clientX,y:e.clientY}),true)")
  }
  const point=selector=>run('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.right-8,y:r.top+Math.min(r.height/2,45)}})()')
  const tap=async({x,y},hold=35)=>{
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await wait(hold)
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(120)
  }
  const swipe=async(x,y,dx,dy=0)=>{
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]})
    for(let i=1;i<=6;i++){await wait(20);await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/6,y:y+dy*i/6,id:1}]})}
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(150)
  }
  const capture=async name=>{
    const out=process.env.FOLIO_TEST_OUTPUT||path.join(process.cwd(),'test-results');fs.mkdirSync(out,{recursive:true})
    fs.writeFileSync(path.join(out,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  }
  if (!process.env.FOLIO_ONLY_BOUNDARY) {
  await navigate('table')
  assert.equal(await run("!!document.querySelector('.toolbar')"),false)
  assert.ok(await run("!!document.querySelector('.mobile-dock')"))
  await tap(await point('.markdown table'))
  assert.equal(await page(),2,'a non-scrolling table must not block a tap')
  console.log('PASS non-overflowing table tap')
  await navigate('table')
  const table=await point('.markdown table')
  await swipe(290,table.y,-160)
  assert.equal(await page(),2,'a non-scrolling table must not block a swipe')
  console.log('PASS non-overflowing table swipe')
  await navigate('code')
  await tap(await point('.markdown pre'))
  assert.equal(await page(),2,'short code is content, not a control')
  await navigate('image')
  await until(()=>run("document.querySelector('.markdown img')?.complete"))
  await tap(await point('.markdown img'))
  assert.equal(await page(),2,'static images are not controls')
  console.log('PASS short code and image tap')
  await navigate('wide')
  assert.ok(await run("document.querySelector('table').hasAttribute('data-reader-scroll-x')"))
  const wide=await point('.markdown table')
  await swipe(285,wide.y,-150)
  assert.equal(await page(),1,'horizontal table scroll takes priority')
  assert.ok(await run("document.querySelector('table').scrollLeft > 0"),'the table itself must actually scroll')
  await run("document.querySelector('table').focus({preventScroll:true})")
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
  assert.equal(await page(),1)
  console.log('PASS native horizontal table scrolling and keyboard focus')
  await navigate('plain')
  await swipe(285,180,-155);assert.equal(await page(),2)
  await swipe(100,180,155);assert.equal(await page(),1)
  await swipe(190,180,15,140);assert.equal(await page(),1)
  await swipe(12,180,160);assert.equal(await page(),1)
  await tap({x:345,y:150},600);assert.equal(await page(),1)
  console.log('PASS swipe direction, vertical scroll, edge exclusion and long press')
  await navigate('plain')
  await run("const range=document.createRange();const text=document.querySelector('.markdown p').firstChild;range.setStart(text,0);range.setEnd(text,3);getSelection().removeAllRanges();getSelection().addRange(range)")
  await tap({x:345,y:170})
  assert.equal(await page(),1,'selection dismissal must not turn a page')
  await run("getSelection().removeAllRanges()")
  await navigate('plain')
  await run("document.querySelector('.markdown').insertAdjacentHTML('afterbegin','<button style=\"position:fixed;top:110px;right:32px;width:110px;height:44px;z-index:2\" onclick=\"window.interactions++\">交互按钮</button>')")
  await tap(await point('.markdown button'))
  assert.equal(await run('interactions'),1);assert.equal(await page(),1)
  console.log('PASS control priority')
  }
  await navigate('link')
  await tap(await point('.markdown a'))
  await until(()=>run("document.querySelector('.mobile-document-title strong')?.textContent.includes('02-')"))
  assert.equal(await page(),1)
  console.log('PASS Markdown link priority')
  await navigate('external')
  await tap(await point('.markdown a'))
  assert.ok(await run("!!document.querySelector('[aria-label=\"打开外部链接？\"]')"))
  assert.equal(await run("calls.filter(c=>c.cmd==='plugin:opener|open_url').length"),0)
  await capture('folio-external-link-confirmation')
  await click('[aria-label="关闭打开外部链接？"]')
  await tap(await point('.markdown a'))
  await click('.reader-dialog .primary')
  assert.equal(await run("calls.filter(c=>c.cmd==='plugin:opener|open_url').length"),1)
  await navigate('link')
  await tap(await point('.markdown a'),1300)
  await until(()=>run("!!document.querySelector('[aria-label=\"链接地址\"]')"))
  assert.ok(await run("document.querySelector('.reader-dialog').textContent.includes('02-下一章.md')"))
  await click('[aria-label="关闭链接地址"]')
  assert.equal(await page(),1)
  console.log('PASS external confirmation and touch long-press link preview')
  await navigate('boundary')
  await until(()=>run("!document.querySelector('.next-document').disabled"))
  await swipe(280,180,-150)
  await until(()=>run("document.querySelector('.mobile-document-title strong')?.textContent.includes('02-')"))
  await swipe(100,180,150)
  await until(()=>run("document.querySelector('.mobile-document-title strong')?.textContent.includes('01-')"))
  assert.equal(await run("JSON.parse(localStorage.getItem('folio:layout:main')).groups[0].tabs.length"),1)
  console.log('PASS cross-document paging in current tab')
  await navigate('design')
  await tap({x:195,y:380})
  assert.ok(await run("document.querySelector('.shell').classList.contains('mobile-immersive')"))
  assert.equal(await run("!!document.querySelector('.mobile-reveal')"),false)
  assert.ok(await run("[...document.querySelectorAll('.page-nav button')].every(b=>getComputedStyle(b).display!=='none' && b.getBoundingClientRect().height>=44)"))
  const focusedPage=await page()
  await tap(await point('.next-document'))
  assert.equal(await page(),focusedPage+1)
  await tap({x:195,y:380})
  await until(()=>run("!!document.querySelector('.mobile-dock')"))
  await click('[aria-label="阅读设置"]')
  assert.equal(await run("document.querySelectorAll('.settings select').length"),0)
  await click('[role="switch"][aria-label="单页翻页"]')
  await until(()=>run("JSON.parse(localStorage.getItem('folio:settings')).readingMode==='scroll'"))
  await click('[aria-label="增大字号"]')
  assert.equal(await run("JSON.parse(localStorage.getItem('folio:settings')).font"),18)
  await capture('folio-mobile-settings')
  await click('[aria-label="关闭阅读外观"]')
  await click('[aria-label="打开文档库"]');await capture('folio-mobile-library')
  await run("window.dispatchEvent(new CustomEvent('folio-back',{cancelable:true}))")
  await until(()=>run("!document.querySelector('.mobile-sheet')"))
  await click('[aria-label="切换分屏"]')
  await until(()=>run("document.querySelectorAll('.reader').length===2"))
  assert.ok(await run("document.querySelector('.surface').classList.contains('column')"))
  const identity=await run("JSON.parse(localStorage.getItem('folio:layout:main')).groups.map(g=>[g.id,g.tabs.map(t=>t.id)])")
  await metrics(844,390)
  await until(()=>run("document.querySelector('.surface').classList.contains('row')"))
  assert.deepEqual(await run("JSON.parse(localStorage.getItem('folio:layout:main')).groups.map(g=>[g.id,g.tabs.map(t=>t.id)])"),identity)
  await capture('folio-mobile-landscape')
  await metrics(390,844)
  await click('[aria-label="切换分屏"]')
  await until(()=>run("document.querySelectorAll('.reader').length===1"))
  assert.equal(await run("JSON.parse(localStorage.getItem('folio:layout:main')).groups[0].tabs.length"),2,'merge must preserve both panes tabs')
  await capture('folio-mobile-reader')
  await click('[aria-label="文章目录"]')
  assert.equal(await run("document.querySelectorAll('.mobile-reading-progress > span').length"),1,'scroll mode must not display stale page counts')
  assert.ok(await run("document.querySelectorAll('.mobile-toc button').length>0"))
  await click('.mobile-toc button:last-child')
  await until(()=>run("!document.querySelector('.mobile-sheet')"))
  await click('[aria-label="已打开的文档"]')
  assert.equal(await run("document.querySelectorAll('.mobile-tab-row').length"),2)
  await click('.mobile-tab-row .mobile-icon')
  assert.ok(await run("document.querySelector('.mobile-context-actions').textContent.includes('关闭其它')"))
  assert.equal(await run("calls.some(c=>c.cmd.includes('create_webview_window'))"),false)
  assert.equal(await run("document.documentElement.scrollWidth<=innerWidth"),true)

  await click('[aria-label="关闭文档操作"]')
  await click('[aria-label="更多阅读工具"]')
  const handle=await run("(()=>{const r=document.querySelector('.sheet-heading').getBoundingClientRect();return {x:r.left+100,y:r.top+30}})()")
  await swipe(handle.x,handle.y,0,140)
  await until(()=>run("!document.querySelector('.mobile-sheet')"))
  await click('[aria-label="阅读设置"]')
  await run("[...document.querySelectorAll('.reset-settings')][0].click()")
  await until(()=>run("JSON.parse(localStorage.getItem('folio:settings')).font===17 && JSON.parse(localStorage.getItem('folio:settings')).readingMode==='scroll'"))
  await click('[role="switch"][aria-label="单页翻页"]')
  await click('[role="switch"][aria-label="点按边缘翻页"]')
  await click('[aria-label="关闭阅读外观"]')
  const before=await page()
  await tap({x:345,y:180})
  assert.equal(await page(),before,'tap setting must be respected')
  await swipe(285,180,-155)
  assert.ok(await page()>before,'swipe stays available when edge taps are off')
  await click('[aria-label="阅读设置"]')
  await click('[role="switch"][aria-label="左右滑动翻页"]')
  await click('[aria-label="关闭阅读外观"]')
  const frozen=await page()
  await swipe(285,180,-155)
  assert.equal(await page(),frozen,'swipe setting must be respected')
  console.log('PASS drag-dismiss, defaults and independent gesture settings')

  assert.deepEqual(errors,[])
  console.log('PASS mobile sheets, settings, focus, tabs, TOC, rotation and merge')

  await metrics(1360,900)
  await navigate('table&desktop=1')
  assert.ok(await run("!!document.querySelector('.toolbar')"))
  assert.equal(await run("!!document.querySelector('.mobile-dock')"),false)
  const target=await point('.markdown table')
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1})
  await until(async()=>await page()===2)
  await click('[aria-label="阅读设置"]')
  assert.equal(await run("document.querySelectorAll('.settings select').length"),0)
  assert.ok(await run("!!document.querySelector('[aria-label=\"正文宽度\"]')"))
  await click('[aria-label="关闭阅读设置"]')
  await run("document.querySelector('.reading-scroll').focus()")
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
  assert.equal(await run("getComputedStyle(document.querySelector('.reading-scroll')).outlineStyle"),'none')
  await navigate('external&desktop=1')
  const hover=await point('.markdown a')
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...hover})
  assert.equal(await run("document.querySelector('.markdown a').title"),'https://example.com/folio')
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...hover,button:'left',clickCount:1})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...hover,button:'left',clickCount:1})
  await until(()=>run("!!document.querySelector('.reader-dialog')"))
  await capture('folio-desktop-external-link')
  await click('.reader-dialog .primary')
  assert.equal(await run("calls.filter(c=>c.cmd==='plugin:opener|open_url').length"),1)
  console.log('PASS desktop link hover, confirmation and reading focus')
  console.log('PASS desktop layout, non-overflowing table click and settings')
  await metrics(390,844)

  await navigate('plain')
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:180,id:1},{x:230,y:200,id:2}]})
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(await page(),1)
  console.log('PASS multi-touch exclusion')
  // Exercise both platform adapters using controlled remote revisions, through visible controls.
  for (const desktop of [false,true]) {
    await metrics(desktop?1360:390,desktop?900:844)
    await navigate('plain'+(desktop?'&desktop=1':''))
    if (!desktop) await click('[aria-label="更多阅读工具"]')
    await click(desktop?'[aria-label="添加远程仓库"]':'.mobile-tool-grid button:nth-child(3)')
    const fill=async(selector,value)=>run('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()')
    await fill('.remote-dialog input','https://github.com/example/notes')
    await run("[...document.querySelectorAll('.remote-dialog button')].find(b=>b.textContent==='在线读取').click()")
    assert.equal(await run("document.querySelector('.remote-dialog input').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))"),true,'input context menu must remain enabled')
    await click('.remote-dialog button[type="submit"]')
    await until(()=>run("!document.querySelector('.remote-dialog')"))
    if (!desktop) await click('[aria-label="打开文档库"]')
    await until(()=>run("[...document.querySelectorAll('.tree-button')].some(b=>b.textContent.includes('README.md'))"))
    await run("[...document.querySelectorAll('.tree-button')].find(b=>b.textContent.includes('README.md')).click()")
    await until(()=>run("document.querySelector('.markdown')?.textContent.includes('commit-1')"))
    await run('window.remoteGeneration=2')
    if (!desktop) await click('[aria-label="更多阅读工具"]')
    await click(desktop?'[aria-label="刷新文档库"]':'.mobile-tool-grid button:nth-child(2)')
    await until(()=>run("document.querySelector('.markdown')?.textContent.includes('commit-2')"))
    await run('window.remoteFail=true')
    if (!desktop) await click('[aria-label="更多阅读工具"]')
    await click(desktop?'[aria-label="刷新文档库"]':'.mobile-tool-grid button:nth-child(2)')
    await until(()=>run("document.querySelector('.toast')?.textContent.includes('部分远程仓库')"))
    assert.ok(await run("document.querySelector('.markdown').textContent.includes('commit-2')"))
    await run('window.remoteFail=false')
    if (!desktop) await click('[aria-label="打开文档库"]')
    assert.ok(await run("[...document.querySelectorAll('.tree-button')].some(b=>b.textContent.includes('NEW.md'))"))
    await click('[aria-label="修改仓库配置"]')
    await until(()=>run("!!document.querySelector('.remote-dialog')"))
    await capture(desktop?'folio-desktop-repository-settings':'folio-mobile-repository-settings')
    await fill('.remote-dialog label:nth-of-type(2) input','release')
    await click('.remote-dialog button[type="submit"]')
    await until(()=>run("!document.querySelector('.remote-dialog')"))
    assert.equal(await run("JSON.parse(localStorage.getItem('folio:remote-repositories'))[0].branch"),'release')
    assert.equal(await run("calls.filter(c=>c.cmd==='remote_resolve').at(-1).args.token"),null,'blank token must reuse saved credential')
    if (!desktop) await click('[aria-label="打开文档库"]')
    await click('[aria-label="移出文档库"]')
    assert.ok(await run("!!document.querySelector('[aria-label=\"移出文档库？\"]')"))
    await click('.reader-dialog footer .action:not(.primary)')
    assert.equal(await run("JSON.parse(localStorage.getItem('folio:roots')).length"),2)
    await click('[aria-label="移出文档库"]')
    await capture(desktop?'folio-desktop-remove-confirmation':'folio-mobile-remove-confirmation')
    await click('[role="switch"][aria-label="以后不再提醒"]')
    await click('.reader-dialog .primary')
    assert.equal(await run("JSON.parse(localStorage.getItem('folio:settings')).confirmRemoval"),false)
    await click('[aria-label="移出文档库"]')
    assert.equal(await run("!!document.querySelector('.reader-dialog')"),false)
    assert.equal(await run("JSON.parse(localStorage.getItem('folio:roots')).length"),0)
    console.log('PASS '+(desktop?'desktop':'Android')+' remote refresh, configuration editing, native input menu and removal confirmation')
  }
  for (const desktop of [false,true]) {
    await metrics(desktop?1360:390,desktop?900:844)
    await navigate('design'+(desktop?'&desktop=1':''))
    const originalPosition=await run("JSON.stringify(JSON.parse(localStorage.getItem('folio:layout:main')))")
    if (desktop) {
      await run("document.querySelector('.tab').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))")
      await run("[...document.querySelectorAll('.context-menu button')].find(b=>b.textContent==='查看 Markdown 源码').click()")
    } else { await click('[aria-label="更多阅读工具"]'); await click('.mobile-source-entry') }
    await until(()=>run("!!document.querySelector('.source-line')"))
    assert.equal(await run("document.querySelector('.source-viewer [aria-label=\"源码阅读模式\"] button').getAttribute('aria-pressed')"),'true')
    assert.ok(await run("document.querySelector('.source-text').textContent.split(String.fromCharCode(10))[0]==='# 留一点时间给阅读'"))
    assert.equal(await run("document.querySelectorAll('.source-viewer textarea,[contenteditable=true]').length"),0)
    assert.ok(await run("[...document.querySelectorAll('.source-segments button')].every(b=>b.getBoundingClientRect().height>=44)"))
    const total=await run("Number(document.querySelector('.source-pagination output').textContent.split('/')[1])")
    assert.ok(total>1)
    await tap(await point('.source-pagination button:last-child'))
    assert.ok(await run("document.querySelector('.source-pagination output').textContent.startsWith('2 /')"))
    const selectedPage=await run("document.querySelector('.source-pagination output').textContent")
    await run("const range=document.createRange();const line=document.querySelector('.source-line').firstChild;range.setStart(line,0);range.setEnd(line,1);getSelection().removeAllRanges();getSelection().addRange(range);document.querySelector('.source-scroll').focus()")
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',modifiers:8,windowsVirtualKeyCode:39})
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
    assert.equal(await run("document.querySelector('.source-pagination output').textContent"),selectedPage,'source selection takes priority over keyboard paging')
    await run('getSelection().removeAllRanges()')
    await click('[role="switch"][aria-label="对照阅读"]')
    await until(()=>run("document.querySelector('.source-preview').getBoundingClientRect().height>0"))
    if(!desktop) {
      await call('Emulation.setDeviceMetricsOverride',{width:390,height:300,deviceScaleFactor:1,mobile:true,screenWidth:390,screenHeight:844,screenOrientation:{type:'portraitPrimary',angle:0}})
      assert.ok(await run("document.querySelector('.source-viewer').classList.contains('source-portrait')"),'keyboard-sized viewport must not change physical comparison orientation')
      await metrics(390,844)
    }
    assert.equal(await run("document.querySelector('[role=switch][aria-label=\"同步位置\"]').getAttribute('aria-checked')"),'true')
    await click('.source-segments button:last-child')
    await until(()=>run("JSON.parse(localStorage.getItem('folio:settings')).sourceReadingMode==='scroll'"))
    assert.equal(await run("JSON.parse(localStorage.getItem('folio:settings')).readingMode"),'paged','source reading mode must not change the main reader mode')
    const rawPoint=await point('.source-scroll')
    if (!desktop) await swipe(rawPoint.x-50,rawPoint.y+90,0,-150)
    else await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:rawPoint.x-50,y:rawPoint.y+90,deltaX:0,deltaY:350})
    await until(()=>run("document.querySelector('.source-scroll').scrollTop>0 && document.querySelector('.source-preview').scrollTop>0"))
    await wait(350)
    const stable=await run("[document.querySelector('.source-scroll').scrollTop,document.querySelector('.source-preview').scrollTop]")
    await wait(300)
    assert.deepEqual(await run("[document.querySelector('.source-scroll').scrollTop,document.querySelector('.source-preview').scrollTop]"),stable,'sync must settle without feedback loops')
    const previewPoint=await point('.source-preview')
    if(!desktop)await swipe(previewPoint.x-50,previewPoint.y+70,0,-150)
    else await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:previewPoint.x-50,y:previewPoint.y+70,deltaX:0,deltaY:300})
    await until(()=>run('document.querySelector(".source-scroll").scrollTop>'+stable[0]))
    await capture(desktop?'folio-desktop-source-compare':'folio-mobile-source-compare')
    if(!desktop){await metrics(844,390);await until(()=>run("document.querySelector('.source-panes').getBoundingClientRect().width>700"));await capture('folio-source-landscape');await metrics(390,844)}
    const fill=async(selector,value)=>run('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()')
    await fill('[aria-label="搜索源码"]','第 20 节')
    await until(()=>run("document.querySelector('.source-match')?.textContent.includes('第 20 节')"))
    await click('.source-segments button:first-child')
    await until(()=>run("!!document.querySelector('.source-pagination')"))
    for(let guard=0;guard<100 && await run("!document.querySelector('.source-pagination button:last-child').disabled");guard++) await click('.source-pagination button:last-child')
    assert.equal(await run("document.querySelector('.source-pagination output').textContent.split('/').map(s=>s.trim()).every((s,i,a)=>s===a[0])"),true,'last source page must be reachable without a pagination loop')
    await click('[aria-label="关闭源码"]')
    assert.equal(await run("JSON.stringify(JSON.parse(localStorage.getItem('folio:layout:main')))") ,originalPosition)
    if(!desktop)await click('[aria-label="更多阅读工具"]')
    await click(desktop?'[aria-label="添加远程仓库"]':'.mobile-tool-grid button:nth-child(3)')
    await fill('.remote-dialog input','https://github.com/example/clone')
    await click('.remote-dialog button[type="submit"]')
    await until(()=>run("!document.querySelector('.remote-dialog') && !!document.querySelector('[aria-label=\"更新本地仓库\"]')"))
    assert.ok(await run("[...document.querySelectorAll('.source-tag')].some(e=>e.textContent==='本地克隆')"))
    await run("[...document.querySelectorAll('.tree-button')].find(b=>b.textContent.includes('README.md')).click()")
    await until(()=>run("document.querySelector('.markdown')?.textContent.includes('本地版本 1')"))
    if(!desktop)await click('[aria-label="打开文档库"]')
    await click('[aria-label="更新本地仓库"]')
    await until(()=>run("document.querySelector('.markdown')?.textContent.includes('本地版本 2')"))
    await run('window.cloneFail=true')
    await click('[aria-label="更新本地仓库"]')
    await until(()=>run("document.querySelector('.toast')?.textContent.includes('原副本保留')"))
    assert.ok(await run("document.querySelector('.markdown').textContent.includes('本地版本 2')"))
    await run('window.cloneFail=false')
    if(!desktop){await click('[aria-label="关闭文档库"]');await click('[aria-label="更多阅读工具"]')}
    await click(desktop?'[aria-label="刷新文档库"]':'.mobile-tool-grid button:nth-child(2)')
    await until(()=>run("document.querySelector('.markdown')?.textContent.includes('本地版本 3')"))
    if (desktop) {
      await run('window.cloneManaged=false')
      await click('[aria-label="刷新文档库"]')
      await until(()=>run("[...document.querySelectorAll('.source-tag')].some(e=>e.textContent==='Git 文件夹')"))
      assert.equal(await run('window.cloneGeneration'),3,'unmanaged Git folders must not be overwritten by global update')
      await click('[aria-label="启用仓库更新"]')
      await click('.reader-dialog footer .action:not(.primary)')
      assert.equal(await run("calls.filter(c=>c.cmd==='local_clone_adopt').length"),0)
      await click('[aria-label="启用仓库更新"]')
      await click('.reader-dialog .primary')
      await until(()=>run("!!document.querySelector('.remote-dialog')"))
      await click('.remote-dialog button[type="submit"]')
      await until(()=>run("document.querySelector('.markdown')?.textContent.includes('本地版本 4')"))
      assert.equal(await run("calls.filter(c=>c.cmd==='local_clone_adopt').length"),1)
      console.log('PASS explicit adoption required before replacing legacy Windows Git folders')
    }
    console.log('PASS '+(desktop?'desktop':'Android')+' source pagination, raw text, bidirectional sync, search, local clone tags, manual/global update and failure preservation')
  }
  assert.deepEqual(errors,[])
  ws.close()
})().catch(async error=>{
  console.error(error)
  if(global.debugRun)console.log(await global.debugRun("({body:document.body.innerText.slice(0,1800),page:document.querySelector('.page-number')?.textContent,events:window.pointerLog,selection:getSelection()?.toString()})").catch(()=>null))
  if(global.debugCall){const shot=await global.debugCall('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(shot)fs.writeFileSync(path.join(os.tmpdir(),'folio-mobile-failure.png'),Buffer.from(shot.data,'base64'))}
  process.exitCode=1
}).finally(()=>proc.kill())
