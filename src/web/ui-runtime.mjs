export function createUiRuntime({document,window,root,raf=window.requestAnimationFrame.bind(window)}) {
  const spotlightNodes=new WeakSet(),counterNodes=new WeakSet(),owned=[];
  const reduced=Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const coarse=Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const trigger=document.querySelector('[data-mobile-more]');
  const drawer=document.querySelector('[data-more-drawer]');
  const backdrop=document.querySelector('[data-more-backdrop]');
  const closeButton=document.querySelector('[data-more-close]');
  const skipLink=document.querySelector('[data-skip-link]');
  let disposed=false,lastRouteIdentity=null,drawerOpen=false;

  function listen(target,type,listener,options) {
    if(!target)return;
    target.addEventListener(type,listener,options);owned.push([target,type,listener,options]);
  }
  function focusables(){return [...(drawer?.querySelectorAll('[data-more-focusable]')??[])].filter(node=>!node.hidden&&node.getAttribute?.('disabled')===null);}
  function closeMore({restoreFocus=true}={}) {
    if(disposed||!drawer)return;
    drawerOpen=false;drawer.hidden=true;if(backdrop)backdrop.hidden=true;
    trigger?.setAttribute('aria-expanded','false');if(root)root.inert=false;
    if(restoreFocus)trigger?.focus();
  }
  function openMore() {
    if(disposed||!drawer)return;
    drawerOpen=true;drawer.hidden=false;if(backdrop)backdrop.hidden=false;
    trigger?.setAttribute('aria-expanded','true');if(root)root.inert=true;
    (focusables()[0]??closeButton)?.focus();
  }
  function onKeydown(event) {
    if(!drawerOpen)return;
    if(event.key==='Escape'){event.preventDefault?.();closeMore();return;}
    if(event.key!=='Tab')return;
    const items=focusables();if(!items.length)return;
    const first=items[0],last=items.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault?.();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault?.();first.focus();}
  }
  function enhanceSpotlight(node) {
    if(spotlightNodes.has(node))return;spotlightNodes.add(node);
    if(reduced||coarse)return;
    const move=event=>{const bounds=node.getBoundingClientRect?.()??{left:0,top:0};node.style.setProperty('--spotlight-x',`${event.clientX-bounds.left}px`);node.style.setProperty('--spotlight-y',`${event.clientY-bounds.top}px`);};
    listen(node,'pointermove',move);
  }
  function enhanceCounter(node) {
    if(counterNodes.has(node))return;counterNodes.add(node);
    const value=(node.textContent??'').trim();node.setAttribute('aria-label',value);node.classList.add('counter-ready');
    if(!reduced&&!coarse)raf(()=>{if(!disposed)node.classList.add('counter-settled');});
  }
  function refresh(section) {
    if(disposed)return;
    for(const node of document.querySelectorAll('[data-nav]')) {
      const active=node.dataset.nav===section||(node.dataset.nav==='more'&&!['home','trips','footprints'].includes(section));
      node.classList.toggle('active',active);
      if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
    }
    for(const node of root.querySelectorAll('[data-spotlight]'))enhanceSpotlight(node);
    for(const node of root.querySelectorAll('[data-counter]'))enhanceCounter(node);
    const heading=root.querySelector('h1'),identity=`${section}:${heading?.textContent??''}`,routeChanged=identity!==lastRouteIdentity;
    if(routeChanged){lastRouteIdentity=identity;if(heading){heading.setAttribute('tabindex','-1');heading.focus();}}
    if(routeChanged&&!reduced&&!coarse){root.classList.remove('route-entering');raf(()=>{if(!disposed)root.classList.add('route-entering');});}
  }
  function dispose() {
    if(disposed)return;
    closeMore({restoreFocus:false});disposed=true;
    for(const [target,type,listener,options] of owned.splice(0))target.removeEventListener(type,listener,options);
    root.classList.remove('route-entering');
  }

  listen(document,'keydown',onKeydown);
  listen(trigger,'click',()=>drawerOpen?closeMore():openMore());
  listen(closeButton,'click',()=>closeMore());
  listen(backdrop,'click',()=>closeMore());
  listen(skipLink,'click',event=>{event.preventDefault();root.focus();});
  listen(root,'animationend',event=>{if(event.target===root)root.classList.remove('route-entering');});
  trigger?.setAttribute('aria-expanded','false');
  return {refresh,openMore,closeMore,dispose};
}
