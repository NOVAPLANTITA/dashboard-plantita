/**
 * Comercial Nova Plantita — registro de venda de saco fechado no mesmo PDV.
 * Um código bipado = um saco fechado vendido, independente de abertura e de PDV_Vendas.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id),scan=$('scanForm'),barcode=$('barcode');
if(!scan||!barcode||$('closedBagToggle'))return;
const keyURL='plantita_medicamentos_sync_endpoint_v1',
      keySecret='plantita_medicamentos_sync_access_v1',
      pendingKey='plantita_pdv_saco_vendido_pendente_v1';
scan.insertAdjacentHTML('afterend',`
<div class="btnline" style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:12px 0">
 <button class="secondary" id="closedBagToggle" type="button">🛍 VENDER SACO FECHADO</button>
 <span class="fine" id="closedBagHint">Não é abertura para granel</span>
</div>
<section id="closedBagPanel" style="display:none;border:1px solid #34766b;background:#092c2b;padding:15px;border-radius:12px;margin:12px 0">
 <h3 style="margin:0 0 9px">🛍 Venda de saco fechado</h3>
 <p class="fine">Bipe o EAN original da embalagem no leitor acima, confira a ração e informe o preço de venda. Cada registro corresponde a <b>1 saco fechado vendido</b> e irá para a aba <b>Sacos_Vendidos</b>, sem marcar abertura de granel.</p>
 <p id="closedBagStatus" role="status" aria-live="polite" class="fine">Aguardando conexão...</p>
 <form id="closedBagForm" style="display:grid;gap:9px">
  <div class="field"><label>EAN da embalagem</label><input id="closedBagEAN" readonly></div>
  <div class="field"><label>Produto</label><input id="closedBagProduct" required maxlength="220" placeholder="Nome exato da ração"></div>
  <div class="field"><label>Marca</label><input id="closedBagBrand" required maxlength="90" placeholder="Marca da ração"></div>
  <div class="field"><label>Peso do saco (kg)</label><input id="closedBagKg" required inputmode="decimal" placeholder="Ex.: 20"></div>
  <div class="field"><label>Preço de VENDA (R$)</label><input id="closedBagPrice" required inputmode="decimal" placeholder="Ex.: 129,90"></div>
  <div class="btnline" style="display:flex;gap:9px;flex-wrap:wrap">
   <button id="closedBagSubmit" class="primary" type="submit" disabled>✓ REGISTRAR 1 SACO VENDIDO NO GOOGLE</button>
   <button id="closedBagClear" class="ghost" type="button">Limpar</button>
   <button id="closedBagCheck" class="ghost" type="button">↻ Verificar conexão</button>
  </div>
 </form>
 <p class="fine">O saldo será calculado posteriormente pelas DANFEs e por estas saídas. Não haverá baixa automática na planilha de estoque nem soma em PDV_Vendas. Se o Google não confirmar, reutilize o mesmo registro pendente.</p>
</section>`);
let active=false,busy=false,enabled=false,selected=null,pending=null;
try{pending=JSON.parse(localStorage.getItem(pendingKey)||'null')}catch(_){}
const report=(msg,bad=false)=>{$('closedBagStatus').textContent=msg;$('closedBagStatus').style.color=bad?'#ffaaaa':'#b0f4cc'};
const conf=()=>({url:(localStorage.getItem(keyURL)||'').trim(),secret:(localStorage.getItem(keySecret)||'').trim()});
function urlOK(t){try{const u=new URL(t);return u.protocol==='https:'&&((u.hostname==='script.google.com'&&/^\/macros\/s\/[^/]+\/exec\/?$/.test(u.pathname))||(u.hostname==='script.googleusercontent.com'&&u.pathname.length>1))}catch(_){return false}}
function validEAN(s){
 if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)||/^2\d{12}$/.test(s))return false;
 const d=Array.from(s,Number),check=d.pop();let sum=0;
 for(let i=d.length-1,j=0;i>=0;i--,j++)sum+=d[i]*(j%2===0?3:1);
 return (10-sum%10)%10===check;
}
const clean=s=>String(s||'').replace(/^\](?:E0|E1|C0|C1)/i,'').replace(/[\s\u200b-\u200d\ufeff]/g,'');
function parseKg(raw){let n=Number(String(raw||'').trim().replace(',','.'));return Number.isFinite(n)&&n>0&&n<=60?Math.round(n*1000)/1000:null}
function parsePrice(raw){
 let x=String(raw||'').replace(/^\s*R\$/i,'').trim();
 if(!/^\d{1,7}([,.]\d{1,2})?$/.test(x))return null;
 let n=Math.round(Number(x.replace(',','.'))*100);
 return Number.isSafeInteger(n)&&n>0&&n<=100000000?n:null;
}
const currency=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
function controls(){
 $('closedBagPanel').style.display=active?'block':'none';
 $('closedBagToggle').textContent=active?'← VOLTAR ÀS VENDAS':'🛍 VENDER SACO FECHADO'+(pending?' • PENDENTE':'');
 $('closedBagHint').textContent=active?'MODO SACO FECHADO • 1 bipagem = 1 saco':'Não é abertura para granel';
 $('closedBagSubmit').disabled=busy||!enabled||(!selected&&!pending);
 $('closedBagClear').disabled=busy||!!pending;
 if(active){barcode.placeholder='Bipe o EAN original do saco fechado';
   let add=scan.querySelector('button[type="submit"]');if(add)add.textContent='LOCALIZAR SACO FECHADO';
 }else if(!$('bagModePanel')||$('bagModePanel').style.display!=='block'){
   barcode.placeholder='Bipe aqui ou digite um código e Enter';
   let add=scan.querySelector('button[type="submit"]');if(add)add.textContent='ADICIONAR';
 }
}
function fill(p,locked=false){
 selected={code:String(p.code)};
 $('closedBagEAN').value=p.code;
 $('closedBagProduct').value=p.produto||'';
 $('closedBagBrand').value=p.marca||'';
 $('closedBagKg').value=p.pesoKg==null?'':String(p.pesoKg).replace('.',',');
 $('closedBagPrice').value=p.precoCentavos==null?'':String((p.precoCentavos/100).toFixed(2)).replace('.',',');
 $('closedBagProduct').readOnly=locked||!!p.produto;
 $('closedBagBrand').readOnly=locked||!!p.marca;
 $('closedBagKg').readOnly=locked;
 $('closedBagPrice').readOnly=locked;
 controls();
}
function showPending(){if(!pending)return;active=true;fill(pending,true);report('⚠ Venda pendente de recibo. Clique Registrar para consultar o MESMO ID. Não bipe nem cobre outra vez.',true)}
function clearFields(){
 selected=null;
 for(let k of ['closedBagEAN','closedBagProduct','closedBagBrand','closedBagKg','closedBagPrice']){$(k).value='';$(k).readOnly=false}
 controls();
}
function get(action,params={}){
 let c=conf();
 if(!urlOK(c.url)||c.secret.length<20)return Promise.reject(Error('Google não configurado neste PDV.'));
 return new Promise((resolve,reject)=>{
  let cb='_closedbag_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  let el=document.createElement('script'),done=false,timer=setTimeout(()=>end(Error('Google não respondeu em 15 segundos.')),15000);
  function end(err,data){if(done)return;done=true;clearTimeout(timer);el.remove();delete window[cb];err?reject(err):resolve(data)}
  window[cb]=data=>end(null,data);el.onerror=()=>end(Error('Falha de conexão com Google.'));
  let u=new URL(c.url);u.searchParams.set('action',action);u.searchParams.set('key',c.secret);
  u.searchParams.set('callback',cb);u.searchParams.set('_',String(Date.now()));
  for(let [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
  el.src=u.toString();document.head.appendChild(el);
 }).then(x=>{if(!x||!x.ok)throw Error(x?.error||'Resposta inválida.');return x});
}
async function check(){
 try{
  let h=await get('health');enabled=h.schema>=3&&h.closedBagWriteEnabled===true;
  report(enabled?'✓ Venda de sacos conectada ao Google.':'Atualize a implantação do Google Apps Script para usar esta função.',!enabled);
 }catch(e){enabled=false;report('Sem conexão: '+String(e?.message||e),true)}
 controls();
}
async function lookup(raw){
 if(pending){showPending();return}
 if(busy)return;
 let code=clean(raw);
 if(!validEAN(code)){report('Código inválido. Use o EAN da embalagem, não a etiqueta da balança.',true);return}
 if(!enabled){report('A venda de saco ainda não foi habilitada na ponte do Google.',true);return}
 busy=true;controls();report('Buscando produto pelo código da embalagem...');
 try{
  let x=await get('bag_product',{code}),p=x.product||{};
  fill({code,produto:p.produto||'',marca:p.marca||'',pesoKg:p.pesoKg??null,precoCentavos:null});
  report(x.found?'Produto encontrado. Confira os dados e informe o preço de venda.':'EAN novo. Informe os dados da embalagem e o preço de venda.');
  for(let k of ['closedBagProduct','closedBagBrand','closedBagKg','closedBagPrice'])if(!$(k).value){$(k).focus();break}
 }catch(e){selected=null;report('Erro na consulta: '+String(e?.message||e),true)}
 finally{busy=false;controls()}
}
async function submitToGoogle(p){
 let old=await get('closed_bag_status',{saleBagId:p.saleBagId});
 if(old.found)return old.receipt;
 let c=conf();
 await fetch(c.url,{method:'POST',mode:'no-cors',cache:'no-store',
  headers:{'Content-Type':'text/plain;charset=UTF-8'},
  body:JSON.stringify({action:'sell_closed_bag',key:c.secret,...p})});
 for(let attempt=0;attempt<6;attempt++){
  await new Promise(resolve=>setTimeout(resolve,attempt?1600:1100));
  let x=await get('closed_bag_status',{saleBagId:p.saleBagId});
  if(x.found)return x.receipt;
 }
 throw Error('Sem recibo confirmado no Google.');
}
scan.addEventListener('submit',e=>{
 if(!active)return;
 e.preventDefault();e.stopImmediatePropagation();
 let value=barcode.value;barcode.value='';lookup(value);
},true);
$('closedBagToggle').onclick=()=>{
 if(!active){
  if(localStorage.getItem('plantita_pdv_sacos_abertura_pendente_v1')){
   alert('Finalize primeiro a abertura de saco pendente antes de registrar venda de saco fechado.');return;
  }
  if($('bagModePanel')&&$('bagModePanel').style.display==='block')$('bagModeToggle').click();
 }
 active=!active;controls();
 if(active){if(pending)showPending();check().then(()=>{if(pending)showPending()});if(window.matchMedia('(min-width:750px)').matches)barcode.focus()}
};
if($('bagModeToggle'))$('bagModeToggle').addEventListener('click',()=>{if(active){active=false;controls()}},true);
$('closedBagCheck').onclick=check;
$('closedBagClear').onclick=()=>{if(pending){showPending();return}clearFields();report('Pronto para outra venda de saco.');barcode.focus()};
$('closedBagForm').onsubmit=async e=>{
 e.preventDefault();
 if(busy||!enabled){report('Registro indisponível ou em andamento.',true);return}
 let p=pending;
 if(!p){
  if(!selected){report('Bipe primeiro a embalagem.',true);return}
  let code=selected.code,produto=$('closedBagProduct').value.trim(),
      marca=$('closedBagBrand').value.trim(),pesoKg=parseKg($('closedBagKg').value),
      precoCentavos=parsePrice($('closedBagPrice').value);
  if(!validEAN(code)||!produto||!marca||pesoKg===null||precoCentavos===null){
   report('Confira EAN, produto, marca, peso e preço de venda.',true);return;
  }
  if(!confirm('CONFIRMAR VENDA REAL DE 1 SACO FECHADO?\n\n'+produto+'\n'+marca+
    '\nEAN: '+code+'\nPeso: '+pesoKg+' kg\nPreço: '+currency(precoCentavos)+
    '\n\nNão será abertura para granel.'))return;
  p={saleBagId:'SACOV_'+Date.now()+'_'+Math.random().toString(36).slice(2,12),
    code,produto,marca,pesoKg,precoCentavos};
  try{
   let v=JSON.stringify(p);localStorage.setItem(pendingKey,v);
   if(localStorage.getItem(pendingKey)!==v)throw Error('sem armazenamento');
   pending=p;
  }catch(_){report('Falha ao salvar ID no navegador. Nenhuma venda enviada.',true);return}
 }
 busy=true;controls();report('Consultando o recibo do Google. Não envie novamente.');
 try{
  let receipt=await submitToGoogle(p);
  if(!receipt||receipt.saleBagId!==p.saleBagId||receipt.code!==p.code||
    Number(receipt.pesoKg)!==p.pesoKg||Number(receipt.precoCentavos)!==p.precoCentavos||
    Number(receipt.quantidade)!==1)throw Error('Recibo não confere com a venda.');
  localStorage.removeItem(pendingKey);pending=null;clearFields();
  report('✓ VENDA CONFIRMADA: 1 saco de '+receipt.produto+' • '+currency(receipt.precoCentavos)+' • ID '+receipt.saleBagId);
 }catch(err){report('⚠ Venda sem confirmação: '+String(err?.message||err)+'. Não bipa nem cobre novamente; consulte o mesmo registro.',true)}
 finally{busy=false;controls()}
};
if(pending){showPending();check().then(()=>showPending())}else controls();
})();