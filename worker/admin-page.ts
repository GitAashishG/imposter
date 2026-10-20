function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function adminPage(nonce: string, signedIn: boolean, configured: boolean, publicSite: string): string {
  let publicHref = "https://gitaashishg.github.io/imposter/";
  try { const url = new URL(publicSite); if (url.protocol === "https:" && !url.username && !url.password) publicHref = url.href; } catch { /* Do not render an unsafe return link. */ }
  const content = !configured ? `<section class="panel"><h2>Owner sign-in is not configured</h2><p>Administration is locked until the owner registers a GitHub OAuth app and sets the Worker secrets <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code>.</p><p>The callback must be this Worker's HTTPS origin followed by <code>/admin/auth/callback</code>. The configured immutable owner ID must be <code>9066299</code>. No repository permissions, player accounts, personal access tokens, or CLI credentials are needed.</p><p>Public rooms remain separate from administration.</p></section>` : !signedIn ? `<section class="panel"><h2>Owner access only</h2><p>Sign in with GitHub to manage room capacity and cleanup. Only the configured account owner is allowed. Players do not need GitHub accounts.</p><a class="button" href="/admin/auth/start">Sign in with GitHub</a><p class="muted">No repository permissions are requested. Sign-in lasts 8 hours on this device.</p></section>` : `<section class="panel"><div class="row"><div><h2>Room administration</h2><p id="owner" class="muted">Verifying owner session…</p></div><button id="logout" type="button">Sign out</button></div><p id="status" role="status" aria-live="polite">Loading rooms…</p><form id="cap-form"><label for="room-cap">Maximum simultaneous rooms (1–20)</label><div class="row"><input id="room-cap" name="roomCap" type="number" min="1" max="20" step="1" required><button type="submit">Save capacity</button></div><p class="muted">Lowering capacity never ends existing rooms. It blocks new rooms until there is space.</p></form></section><section class="panel"><div class="row"><h2 id="room-count">Rooms</h2><div class="actions"><button id="refresh" type="button">Refresh</button><button id="purge-expired" type="button">Purge expired / closed</button></div></div><p class="muted">Metadata only: no names, secret words, roles, ballots, joining PINs, recovery codes, or player sessions.</p><div id="rooms" class="rooms"></div></section><dialog id="confirmation" aria-labelledby="confirmation-title"><form id="confirmation-form"><h2 id="confirmation-title">Confirm room action</h2><p id="confirmation-description"></p><label for="confirmation-code" id="confirmation-label">Type the room code to confirm</label><input id="confirmation-code" autocomplete="off" spellcheck="false" required><div class="actions"><button id="cancel-confirmation" type="button">Cancel</button><button id="confirm-action" type="submit" class="danger">Confirm</button></div></form></dialog>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Ko Ho? · Owner administration</title><style nonce="${nonce}">
:root{color-scheme:light;--paper:#f8f5eb;--panel:#fffdf7;--ink:#262c31;--muted:#59626a;--line:#c7c8bf;--accent:#215a4b;--on-accent:#fff;--danger:#a12425;--focus:#186dcc}html[data-theme=dark]{color-scheme:dark;--paper:#141d24;--panel:#1d2a33;--ink:#edf0ec;--muted:#b7c4c9;--line:#52616b;--accent:#a7dbc9;--on-accent:#162e25;--danger:#ffacaa;--focus:#a0c7ff}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:1rem/1.6 system-ui,sans-serif}main{max-width:74rem;margin:auto;padding:1.25rem}h1,h2,h3,p{margin:0 0 .8rem}h1{font-size:1.8rem}h2{font-size:1.25rem}h3{font-size:1.1rem}.row,.actions{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap}.actions{justify-content:flex-start}.panel,.room{background:var(--panel);border:1px solid var(--line);border-radius:1rem;padding:1.25rem;margin-top:1rem}.rooms{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:1rem}.room{margin:0;min-width:0}button,.button,input{font:inherit;border:1px solid var(--line);border-radius:.55rem;min-height:2.75rem;padding:.55rem .9rem}button,.button{cursor:pointer;background:var(--accent);color:var(--on-accent);text-decoration:none;display:inline-block}button:disabled{opacity:.55;cursor:wait}input{background:var(--paper);color:var(--ink);max-width:100%;width:8rem}label{display:block;margin:.5rem 0}.muted,dt{color:var(--muted)}a{color:var(--ink)}.danger{background:var(--panel);color:var(--danger);border-color:var(--danger)}:focus-visible{outline:3px solid var(--focus);outline-offset:3px}dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem 1rem;font-size:.9rem}dd{margin:0;text-align:right;overflow-wrap:anywhere}code{overflow-wrap:anywhere}dialog{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:1rem;max-width:min(32rem,94vw);padding:1.5rem}dialog::backdrop{background:#0008}dialog input{width:100%;margin-bottom:1rem}#status{min-height:1.6em;overflow-wrap:anywhere}header{margin-bottom:1.5rem}footer{margin-top:1.5rem;font-size:.9rem}
</style></head><body><main><header class="row"><div><h1>Ko Ho? <span lang="ne">को हो?</span></h1><p class="muted">Owner administration · separate from public play</p></div><button id="theme" type="button" aria-label="Toggle light or dark appearance">Appearance</button></header>${content}<footer><a href="${escapeHtml(publicHref)}">Return to the game</a></footer></main><script nonce="${nonce}">${themeScript}${signedIn && configured ? dashboardScript : ""}</script></body></html>`;
}

const themeScript = String.raw`
(function(){
  var theme;
  try{theme=localStorage.getItem('koho-admin-theme')}catch(e){}
  if(theme!=='light'&&theme!=='dark')theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  document.documentElement.dataset.theme=theme;
  document.getElementById('theme').addEventListener('click',function(){
    theme=document.documentElement.dataset.theme==='dark'?'light':'dark';
    document.documentElement.dataset.theme=theme;
    try{localStorage.setItem('koho-admin-theme',theme)}catch(e){}
  });
})();
`;

const dashboardScript = String.raw`
(function(){
  var csrf=null,version=null,busy=false,pending=null;
  var status=document.getElementById('status');
  var dialog=document.getElementById('confirmation');
  var codeInput=document.getElementById('confirmation-code');
  function announce(message){status.textContent=message}
  function date(value){return value==null?'—':new Date(value).toLocaleString()}
  function lock(value){busy=value;document.querySelectorAll('button:not(#theme),#room-cap').forEach(function(node){node.disabled=value})}
  async function request(path,body){
    var options={credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'}};
    if(body!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.headers['X-CSRF-Token']=csrf||'';options.body=JSON.stringify(body)}
    var response=await fetch(path,options);
    var data=await response.json();
    if(!response.ok){
      if(response.status===401){csrf=null;announce('Your session ended. Sign in again.');var link=document.createElement('a');link.href='/admin';link.textContent='Open owner sign-in';status.append(' ',link)}
      throw new Error(data.error||'The administration request failed.');
    }
    return data;
  }
  function detail(list,label,value){var dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);list.append(dt,dd)}
  function confirmation(title,description,expected,action){
    if(busy)return;
    pending={expected:expected,action:action};
    document.getElementById('confirmation-title').textContent=title;
    document.getElementById('confirmation-description').textContent=description;
    document.getElementById('confirmation-label').textContent='Type '+expected+' to confirm';
    codeInput.value='';codeInput.setCustomValidity('');dialog.showModal();codeInput.focus();
  }
  function render(data){
    version=data.configVersion;document.getElementById('room-cap').value=data.roomCap;
    document.getElementById('room-count').textContent='Rooms · '+data.activeRooms+' active / '+data.roomCap+' capacity';
    var root=document.getElementById('rooms');root.replaceChildren();
    if(!data.rooms.length){var empty=document.createElement('p');empty.textContent='No rooms are currently retained.';root.append(empty)}
    data.rooms.forEach(function(room){
      var card=document.createElement('article');card.className='room';
      var title=document.createElement('h3');title.textContent=room.roomCode+' · '+room.status;card.append(title);
      var list=document.createElement('dl');
      detail(list,'Phase',room.phase||'—');detail(list,'Players',room.playerCount+' ('+room.connectedCount+' connected)');
      detail(list,'Completed games',room.completedGames);detail(list,'Created',date(room.createdAt));
      detail(list,'Last activity',date(room.lastActivityAt));detail(list,'Inactivity expiry',date(room.expiresAt));
      detail(list,'All-offline expiry',date(room.abandonedExpiresAt));detail(list,'Closed',date(room.closedAt));
      detail(list,'Closure reason',room.closeReason||'—');detail(list,'Storage purged',room.storagePurged?'Yes':'No');card.append(list);
      var actions=document.createElement('div');actions.className='actions';
      if(room.status==='active'&&room.partyId){var close=document.createElement('button');close.type='button';close.className='danger';close.textContent='Close room';close.addEventListener('click',function(){confirmation('Close '+room.roomCode+'?','This ends this party for everyone, revokes invitations and player sessions, and clears personal game storage. Other rooms keep running.',room.roomCode,async function(){await request('/api/admin/rooms/'+room.roomCode+'/close',{partyId:room.partyId})})});actions.append(close)}
      if(room.status==='closed'){var purge=document.createElement('button');purge.type='button';purge.className='danger';purge.textContent='Purge retained entry';purge.addEventListener('click',function(){confirmation('Purge '+room.roomCode+'?','This removes the closed room’s remaining storage and administrative metadata. It cannot be undone.',room.roomCode,async function(){await request('/api/admin/rooms/'+room.roomCode+'/purge',{partyId:room.partyId})})});actions.append(purge)}
      card.append(actions);root.append(card);
    });
  }
  async function reload(){var session=await request('/api/admin/session');csrf=session.csrfToken;document.getElementById('owner').textContent='Signed in as '+session.owner.login+' · session expires '+date(session.expiresAt);render(await request('/api/admin/rooms'))}
  async function perform(action,message){if(busy)return;lock(true);try{await action();await reload();announce(message)}catch(error){announce(error.message||'Unable to complete the request. Refresh and try again.')}finally{lock(false)}}
  document.getElementById('refresh').addEventListener('click',function(){perform(async function(){},'Room metadata refreshed.')});
  document.getElementById('cap-form').addEventListener('submit',function(event){event.preventDefault();var cap=Number(document.getElementById('room-cap').value),capturedVersion=version;if(!Number.isInteger(cap)||cap<1||cap>20||capturedVersion===null){announce('Choose a capacity from 1 to 20 after loading the current configuration.');return}perform(async function(){await request('/api/admin/config',{roomCap:cap,configVersion:capturedVersion})},'Room capacity saved. Existing rooms were not closed.')});
  document.getElementById('purge-expired').addEventListener('click',function(){confirmation('Purge expired and closed rooms?','Only rooms confirmed expired or closed will be purged. Active parties will not be changed. This cannot be undone.','PURGE',async function(){var result=await request('/api/admin/purge-expired',{});announce('Purged '+result.purged+' expired or closed rooms.')})});
  document.getElementById('cancel-confirmation').addEventListener('click',function(){pending=null;dialog.close()});
  dialog.addEventListener('cancel',function(){pending=null});
  codeInput.addEventListener('input',function(){codeInput.setCustomValidity('')});
  document.getElementById('confirmation-form').addEventListener('submit',function(event){event.preventDefault();if(!pending||busy)return;if(codeInput.value.trim()!==pending.expected){codeInput.setCustomValidity('Type '+pending.expected+' exactly.');codeInput.reportValidity();return}var action=pending.action;pending=null;dialog.close();perform(action,'Room cleanup complete.')});
  document.getElementById('logout').addEventListener('click',async function(){if(busy)return;lock(true);try{await request('/admin/logout',{});location.replace('/admin')}catch(error){announce(error.message);lock(false)}});
  perform(async function(){},'Room metadata loaded.');
})();
`;
