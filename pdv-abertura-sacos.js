/**
 * Plantita PDV — abertura de sacos.
 * Módulo isolado: intercepta o leitor SOMENTE quando o modo sacos está ativo.
 * Não altera o carrinho, as vendas ou os recebimentos do PDV.
 */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const scan=$('scanForm'), barcode=$('barcode');
 if(!scan||!barcode||$('bagModeToggle'))return;
 const confUrl='plantita_medicamentos_sync_endpoint_v1';
 const confKey='plantita_medicamentos_sync_access_v1';
 const pendingKey='plantita_pdv_sacos_abertura_pendente_v1';
 const html=String.raw`
 <div class="btnline" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0">
  <button class="secondary" id="bagModeToggle" type="button">📦 ABRIR SACO DE RAÇÃO</button>
  <span class="fine" id="bagModeHint">Aberturas separadas das vendas</span>
 </div>
 <section id="bagModePanel" style="display:none;border:1px solid #2b7470;border-radius:12px;background:#092a2b;padding:15px;margin:12px 0">
   <h3 style="margin:0 0 8px">📦 Registrar saco aberto para o granel</h3>
   <p class="fine">Bipe o código original da embalagem no campo acima. Esta operação registra <b>1 saco aberto</b> na aba <b>Sacos_Abertos</b>. Não entra no carrinho e não gera venda.</p>
   <p id="bagStatusText" class="fine" role="status" aria-live="polite">Verificando conexão com o Google…</p>
   <form id="bagOpeningForm" style="display:grid;gap:10px;margin-top:12px">
    <div class="field"><label for="bagBarcode">EAN da embalagem</label><input id="bagBarcode" readonly placeholder="Bipe no leitor acima"></div>
    <div class="field"><label for="bagProduct">Nome do produto</label><input id="bagProduct" required maxlength="220" placeholder="Nome da ração"></div>
    <div class="field"><label for="bagBrand">Marca</label><input id="bagBrand" required maxlength="90" placeholder="Marca da embalagem"></div>
    <div class="field"><label for="bagKg">Peso real do saco (kg)</label><input id="bagKg" required inputmode="decimal" placeholder="Ex.: 20 ou 15,0"></div>
    <div class="btnline" style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="primary" id="bagConfirm" type="submit" disabled>✓ REGISTRAR SACO ABERTO NO GOOGLE</button>
      <button class="ghost" type="button" id="bagClear">Limpar</button>
      <button class="ghost" type="button" id="bagCheckConnection">↻ Verificar conexão</button>
    </div>
   </form>
   <p class="fine">EAN novo: informe produto, marca e peso. Peso ou marca ausentes/incorretos: confira a embalagem antes de confirmar. O cadastro será atualizado após o registro. Se a confirmação falhar, não bipa de novo: use o mesmo registro pendente.</p>
 </section>
`;
 scan.insertAdjacentHTML('afterend',html);
 let active=false,busy=false,enabled=false,selected=null;
 let pending=null;
 try{pending=JSON.parse(localStorage.getItem(pendingKey)||'null')}catch(_){}
 function announce(t,error=false){
  $('bagStatusText').textContent=t;
  $('bagStatusText').style.color=error?'#ffb0b0':'#aff4d0';
 }
 function config(){return {url:(localStorage.getItem(confUrl)||'').trim(),key:(localStorage.getItem(confKey)||'').trim()}}
 function validUrl(text){
  try{const u=new URL(text);return u.protocol==='https:'&&(
   (u.hostname==='script.google.com'&&/^\/macros\/s\/[^/]+\/exec\/?$/.test(u.pathname))||
   (u.hostname==='script.googleusercontent.com'&&u.pathname.length>1))}
  catch(_){return false}
 }
 function eanValid(text){
  if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(text)||/^2\d{12}$/.test(text))return false;
  const d=Array.from(text,Number),last=d.pop();
  let sum=0;for(let i=d.length-1,j=0;i>=0;i--,j++)sum+=d[i]*(j%2===0?3:1);
  return (10-sum%10)%10===last;
 }
 function cleanBarcode(raw){
  return String(raw||'').replace(/^\](?:E0|E1|C0|C1)/i,'').replace(/[\s\u200b-\u200d\ufeff]/g,'').trim();
 }
 function kgValue(raw){
  const n=Number(String(raw||'').trim().replace(',','.'));
  return Number.isFinite(n)&&n>0&&n<=60?Math.round(n*1000)/1000:null;
 }
 function control(){
  $('bagModePanel').style.display=active?'block':'none';
  $('bagModeToggle').textContent=active?'← VOLTAR ÀS VENDAS':'📦 ABRIR SACO DE RAÇÃO'+(pending?' • PENDENTE':'');
  $('bagModeHint').textContent=active?'MODO SACOS • nenhum valor será cobrado':'Aberturas separadas das vendas';
  $('bagConfirm').disabled=!enabled||busy||(!selected&&!pending);
  $('bagClear').disabled=busy||!!pending;
  barcode.placeholder=active?'Bipe o EAN original do saco e pressione Enter':'Bipe aqui ou digite um código e Enter';
  const add=scan.querySelector('button[type="submit"]');
  if(add)add.textContent=active?'LOCALIZAR SACO':'ADICIONAR';
 }
 function fill(x,readonly=false){
  selected={code:String(x.code)};
  $('bagBarcode').value=x.code;
  $('bagProduct').value=x.produto||'';
  $('bagBrand').value=x.marca||'';
  $('bagKg').value=x.pesoKg===null||x.pesoKg===undefined?'':String(x.pesoKg).replace('.',',');
  $('bagProduct').readOnly=readonly||!!x.produto;
  $('bagBrand').readOnly=readonly||!!x.marca;
  $('bagKg').readOnly=readonly;
  control();
 }
 function showPending(){
  if(!pending)return;
  active=true;fill(pending,true);
  announce('⚠ Abertura pendente de confirmação. Use Registrar para consultar o MESMO ID no Google. Não bipe outra vez.',true);
 }
 function clearFields(){
  selected=null;
  for(const id of ['bagBarcode','bagProduct','bagBrand','bagKg']){$(id).value='';$(id).readOnly=false}
  control();
 }
 async function get(action,params={}){
  const c=config();
  if(!validUrl(c.url)||c.key.length<20)throw Error('Conexão do Google não configurada no PDV.');
  return new Promise((resolve,reject)=>{
   const cb='_plantitaBag_'+Date.now()+'_'+Math.random().toString(36).slice(2);
   const script=document.createElement('script');let completed=false;
   const timer=setTimeout(()=>finish(Error('Google não respondeu em 15 segundos.')),15000);
   function finish(err,data){
    if(completed)return;completed=true;clearTimeout(timer);script.remove();delete window[cb];
    if(err)reject(err);else resolve(data);
   }
   window[cb]=data=>finish(null,data);
   script.onerror=()=>finish(Error('Falha de conexão com Google Apps Script.'));
   const url=new URL(c.url);
   url.searchParams.set('action',action);url.searchParams.set('key',c.key);
   url.searchParams.set('callback',cb);url.searchParams.set('_',String(Date.now()));
   for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
   script.src=url.toString();document.head.appendChild(script);
  }).then(data=>{
   if(!data||data.ok!==true)throw Error(data?.error||'Resposta inválida do Google.');
   return data;
  });
 }
 async function checkConnection(){
  try{
   const health=await get('health');
   enabled=health.schema===3&&health.bagWriteEnabled===true;
   announce(enabled?'✓ Abertura de sacos conectada ao Google. Bipe o EAN da embalagem.':
    '⚠ A função de sacos ainda não foi publicada no Apps Script. Atualize a implantação.',!enabled);
  }catch(e){enabled=false;announce('Abertura de sacos não conectada: '+String(e?.message||e),true)}
  control();
 }
 async function lookup(raw){
  if(pending){showPending();return}
  if(busy)return;
  const code=cleanBarcode(raw);
  if(!eanValid(code)){announce('Código inválido ou etiqueta de preço da balança. Use o EAN da embalagem.',true);return}
  if(!enabled){announce('Atualize a implantação do Apps Script antes de abrir sacos.',true);return}
  busy=true;control();announce('Procurando o EAN na base Produtos_Granel…');
  try{
   const data=await get('bag_product',{code});
   const p=data.product||{};
   fill({code,produto:p.produto||'',marca:p.marca||'',pesoKg:p.pesoKg??null});
   if(!data.found)announce('EAN não cadastrado: preencha o nome, a marca e o peso conforme a embalagem.');
   else if(p.pesoKg===null||!p.marca||!p.produto)announce('⚠ Peso, marca ou nome ausente/incorreto. Confira os campos antes de registrar.',true);
   else announce('Produto localizado! Confira os dados do saco e confirme.');
   if(!p.produto)$('bagProduct').focus();
   else if(!p.marca)$('bagBrand').focus();
   else if(p.pesoKg===null)$('bagKg').focus();
  }catch(e){selected=null;announce('Não foi possível buscar produto: '+String(e?.message||e),true)}
  finally{busy=false;control()}
 }
 async function register(p){
  const initial=await get('bag_status',{bagId:p.bagId});
  if(initial.found)return initial.receipt;
  const c=config();
  // POST opaco: nunca considerar gravado antes de consultar o recibo no Google.
  await fetch(c.url,{method:'POST',mode:'no-cors',cache:'no-store',
   headers:{'Content-Type':'text/plain;charset=UTF-8'},
   body:JSON.stringify({action:'open_bag',key:c.key,bagId:p.bagId,
    code:p.code,produto:p.produto,marca:p.marca,pesoKg:p.pesoKg})});
  for(let attempt=0;attempt<6;attempt++){
   await new Promise(resolve=>setTimeout(resolve,attempt===0?1100:1600));
   const result=await get('bag_status',{bagId:p.bagId});
   if(result.found)return result.receipt;
  }
  throw Error('O Google ainda não confirmou o registro.');
 }
 scan.addEventListener('submit',event=>{
  if(!active)return;
  event.preventDefault();event.stopImmediatePropagation();
  const code=barcode.value;barcode.value='';
  lookup(code);
 },true);
 $('bagModeToggle').onclick=()=>{
  active=!active;control();
  if(active){
   if(pending)showPending();
   else checkConnection();
   if(window.matchMedia('(min-width:750px)').matches)barcode.focus();
  }
 };
 $('bagCheckConnection').onclick=checkConnection;
 $('bagClear').onclick=()=>{
  if(pending){showPending();return}
  clearFields();announce('Pronto para o próximo saco.');barcode.focus();
 };
 $('bagOpeningForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(busy||!enabled){announce('Ponte de sacos ainda indisponível ou envio em andamento.',true);return}
  let p=pending;
  if(!p){
   if(!selected){announce('Bipe o saco primeiro.',true);return}
   const code=selected.code,produto=$('bagProduct').value.trim(),
    marca=$('bagBrand').value.trim(),pesoKg=kgValue($('bagKg').value);
   if(!eanValid(code)||!produto||!marca||pesoKg===null){
    announce('Confira EAN, produto, marca e peso válido (até 60 kg).',true);return
   }
   if(!confirm('CONFIRMAR ABERTURA REAL DE 1 SACO?\n\nProduto: '+produto+
      '\nMarca: '+marca+'\nEAN: '+code+'\nPeso: '+pesoKg+
      ' kg\n\nEste registro NÃO é uma venda.'))return;
   p={bagId:'SACO_'+Date.now()+'_'+Math.random().toString(36).slice(2,12),
    code,produto,marca,pesoKg};
   try{
    const value=JSON.stringify(p);localStorage.setItem(pendingKey,value);
    if(localStorage.getItem(pendingKey)!==value)throw Error('não persistiu');
    pending=p;
   }catch(_){announce('Falha ao preservar o ID neste navegador. Nenhum registro foi enviado.',true);return}
  }
  busy=true;control();announce('Consultando o recibo do Google. Não repita a bipagem.');
  try{
   const receipt=await register(p);
   if(!receipt||receipt.bagId!==p.bagId||receipt.code!==p.code||receipt.pesoKg!==p.pesoKg)
    throw Error('Recibo diferente do saco informado.');
   localStorage.removeItem(pendingKey);
   pending=null;clearFields();
   announce('✓ ABERTURA REGISTRADA NO GOOGLE: '+receipt.produto+' • '+receipt.pesoKg+
    ' kg • ID '+receipt.bagId+'. Pode abrir o próximo saco.');
  }catch(e){announce('⚠ Sem confirmação: '+String(e?.message||e)+
   '. Não repita a bipagem. Clique novamente em Registrar para consultar o MESMO ID.',true)}
  finally{busy=false;control()}
 });
 if(pending)showPending();else control();
})();