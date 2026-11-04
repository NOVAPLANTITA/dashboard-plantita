/**
 * Plantita — salvamento de contagem de sacos FECHADOS (rascunho).
 * Implantar em um projeto Apps Script SEPARADO do PDV.
 * Não modifica a aba Estoque Consolidado, DANFEs, preços oficiais ou vendas.
 *
 * Configurar Propriedades do Script: COUNT_SYNC_TOKEN (segredo >= 24 caracteres).
 * Publicar como Aplicativo da Web (executar como proprietário).
 * Planilha de destino: Base Central Granel Plantita, em ABAS PRÓPRIAS.
 *
 * A gravação é uma FOTO da contagem, nunca uma soma de bipagens. saveId torna
 * reenvios idempotentes e expectedSaveId impede sobrescrever outra contagem.
 */
const COUNT_BOOK_ID = '1Y-CNO7lo5CHZEHZ3-AHX1Se4ubdTQCCtQS3jOQPS6fU';
const COUNT_SAVES_TAB = 'Contagens_Estoque';
const COUNT_LINES_TAB = 'Contagens_Itens';
const COUNT_SAVES_HEADER = ['Save ID','Sessão ID','Salvo em','Iniciado em','Sacos contados','Produtos contados','Preços propostos','Primeira linha itens','Quantidade linhas itens','Save anterior','Versão'];
const COUNT_LINES_HEADER = ['Save ID','Produto ID','Marca','Descrição','Peso do saco','Linha original','Códigos de barras','Sacos contados','Novo preço (centavos)','Preço de referência (centavos)','Estoque de referência','Origem','Cadastro'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  const cb = String(p.callback || '');
  try {
    countAuth_(p.key);
    const action = String(p.action || '');
    if (action === 'health') {
      SpreadsheetApp.openById(COUNT_BOOK_ID).getName();
      return countOut_({ok:true,action,ready:true,schema:1,safeDraftOnly:true},cb);
    }
    if (action === 'latest') {
      const sh=countTab_(COUNT_SAVES_TAB,COUNT_SAVES_HEADER,false);
      const last=countLatest_(sh);
      return countOut_({ok:true,action,found:!!last,
        snapshot:last?countLoad_(last):null},cb);
    }
    if (action === 'save_status') {
      const saveId=String(p.saveId||'');
      countId_(saveId,'save_');
      const sh=countTab_(COUNT_SAVES_TAB,COUNT_SAVES_HEADER,false);
      const found=countFind_(sh,saveId);
      return countOut_({ok:true,action,found:!!found,
        receipt:found?countReceipt_(found):null},cb);
    }
    throw Error('Ação desconhecida');
  } catch(err) {
    return countOut_({ok:false,error:String(err.message||err)},cb);
  }
}

function doPost(e) {
  const lock=LockService.getScriptLock();
  try {
    const body=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
    countAuth_(body.key);
    if(body.action!=='save_count')throw Error('Ação não permitida');
    const saveId=countId_(body.saveId,'save_');
    const sessionId=countId_(body.sessionId,'inv_');
    const expected=String(body.expectedSaveId||'');
    if(expected)countId_(expected,'save_');
    const startedAt=String(body.startedAt||'').slice(0,50);
    if(!/^\d{4}-\d\d-\d\dT/.test(startedAt))throw Error('Início da contagem inválido');
    const items=countValidateItems_(body.items);
    if(!items.length)throw Error('Nenhuma bipagem/preço/código para salvar');
    lock.waitLock(18000);
    const saved=countTab_(COUNT_SAVES_TAB,COUNT_SAVES_HEADER,true);
    const existing=countFind_(saved,saveId);
    if(existing) return countJson_({ok:true,status:'already_saved',receipt:countReceipt_(existing)});
    const last=countLatest_(saved);
    const latestId=last?String(last[0]):'';
    if(latestId!==expected)
      return countJson_({ok:false,code:'CONFLICT',
        error:'Há uma contagem mais recente no Google. Carregue-a antes de gravar para não sobrescrever o trabalho de outro aparelho.'});
    const lines=countTab_(COUNT_LINES_TAB,COUNT_LINES_HEADER,true);
    const first=lines.getLastRow()+1;
    const records=items.map(p=>[
      saveId,p.id,p.marca,p.produto,p.peso,p.row||'',
      p.codes.join(' | '),p.qty===null?'':p.qty,
      p.priceCentavos===null?'':p.priceCentavos,
      p.oldPriceCentavos===null?'':p.oldPriceCentavos,
      p.oldQty===null?'':p.oldQty,p.origem,p.cadastro
    ]);
    countEnsureRows_(lines,first+records.length-1);
    lines.getRange(first,1,records.length,2).setNumberFormat('@');
    lines.getRange(first,7,records.length,1).setNumberFormat('@');
    lines.getRange(first,1,records.length,COUNT_LINES_HEADER.length).setValues(records);
    SpreadsheetApp.flush();
    const total=items.reduce((acc,p)=>acc+(p.qty||0),0);
    const skus=items.filter(p=>p.qty!==null&&p.qty>0).length;
    const prices=items.filter(p=>p.priceCentavos!==null).length;
    const header=[saveId,sessionId,new Date().toISOString(),startedAt,total,skus,prices,first,items.length,expected,1];
    const row=saved.getLastRow()+1;
    countEnsureRows_(saved,row);
    saved.getRange(row,1,1,COUNT_SAVES_HEADER.length).setValues([header]);
    SpreadsheetApp.flush();
    return countJson_({ok:true,status:'saved',receipt:countReceipt_(header)});
  } catch(err) {
    return countJson_({ok:false,error:String(err.message||err)});
  } finally {
    if(lock.hasLock())lock.releaseLock();
  }
}

function countAuth_(key) {
  const secret=PropertiesService.getScriptProperties().getProperty('COUNT_SYNC_TOKEN');
  if(!secret||secret.length<24)throw Error('COUNT_SYNC_TOKEN não configurado');
  if(String(key||'')!==secret)throw Error('Chave da contagem inválida');
}
function countId_(value,prefix) {
  if(!new RegExp('^'+prefix+'[A-Za-z0-9_-]{12,82}$').test(String(value||'')))throw Error('Identificador de contagem inválido');
  return String(value);
}
function countTab_(name,header,create) {
  const book=SpreadsheetApp.openById(COUNT_BOOK_ID);
  let sh=book.getSheetByName(name);
  if(!sh&&create)sh=book.insertSheet(name);
  if(!sh)return null;
  const first=sh.getRange(1,1,1,header.length).getDisplayValues()[0];
  if(first.every(x=>!x)&&create){
    sh.getRange(1,1,1,header.length).setValues([header]);
    sh.setFrozenRows(1);
  } else if(!header.every((v,i)=>String(first[i])===v)) {
    throw Error('Cabeçalho da aba '+name+' diferente do esperado. Nenhum dado alterado.');
  }
  return sh;
}
function countEnsureRows_(sh,last) {
  if(last>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),last-sh.getMaxRows()+100);
}
function countFind_(sh,id) {
  if(!sh||sh.getLastRow()<2)return null;
  const ids=sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues();
  for(let i=ids.length-1;i>=0;i--)if(ids[i][0]===id)
    return sh.getRange(i+2,1,1,COUNT_SAVES_HEADER.length).getValues()[0];
  return null;
}
function countLatest_(sh) {
  if(!sh||sh.getLastRow()<2)return null;
  return sh.getRange(sh.getLastRow(),1,1,COUNT_SAVES_HEADER.length).getValues()[0];
}
function countReceipt_(r) {
  return {saveId:String(r[0]),sessionId:String(r[1]),savedAt:String(r[2]),
    startedAt:String(r[3]),bags:Number(r[4]),skus:Number(r[5]),
    changedPrices:Number(r[6]),itemCount:Number(r[8])};
}
function countLoad_(header) {
  const receipt=countReceipt_(header),sh=countTab_(COUNT_LINES_TAB,COUNT_LINES_HEADER,false);
  const first=Number(header[7]),count=Number(header[8]);
  if(!sh||!Number.isSafeInteger(first)||first<2||!Number.isSafeInteger(count)||count<1||count>600)
    throw Error('Referência do salvamento inválida');
  const rows=sh.getRange(first,1,count,COUNT_LINES_HEADER.length).getValues();
  if(rows.some(r=>String(r[0])!==receipt.saveId))throw Error('Itens da contagem não correspondem ao salvamento');
  const items=rows.map(r=>({
    id:String(r[1]),marca:String(r[2]),produto:String(r[3]),peso:String(r[4]),row:r[5]||'',
    codes:String(r[6]||'').split(/\s*\|\s*/).filter(Boolean),
    qty:r[7]===''?null:Number(r[7]),
    priceCentavos:r[8]===''?null:Number(r[8]),
    oldPriceCentavos:r[9]===''?null:Number(r[9]),
    oldQty:r[10]===''?null:Number(r[10]),
    origem:String(r[11]||''),cadastro:String(r[12]||'')
  }));
  return {receipt,items};
}
function countValidateItems_(items) {
  if(!Array.isArray(items)||items.length<1||items.length>600)throw Error('Quantidade de produtos inválida');
  const ids=new Set(),barcodes=new Set();
  return items.map(raw=>{
    if(!raw||typeof raw!=='object')throw Error('Produto inválido');
    const id=countText_(raw.id,90,true),marca=countText_(raw.marca,100,true),
      produto=countText_(raw.produto,250,true),peso=countText_(raw.peso,40,true);
    if(ids.has(id))throw Error('Produto repetido no lote: '+id);
    ids.add(id);
    const codes=Array.isArray(raw.codes)?raw.codes:[];
    if(codes.length>25)throw Error('Códigos demais para '+id);
    const validCodes=codes.map(x=>String(x||'').trim());
    validCodes.forEach(code=>{
      if(!/^\d{6,18}$/.test(code)||barcodes.has(code))throw Error('Código de barras inválido ou repetido');
      barcodes.add(code);
    });
    const qty=countInteger_(raw.qty,0,1000000);
    const price=countInteger_(raw.priceCentavos,0,1000000000);
    const oldPrice=countInteger_(raw.oldPriceCentavos,0,1000000000);
    const oldQty=countInteger_(raw.oldQty,0,1000000);
    if(qty===null&&price===null&&!validCodes.length)
      throw Error('Item sem contagem, preço ou vínculo');
    return {id,marca,produto,peso,row:raw.row==null?'':countText_(raw.row,15,false),
      codes:validCodes,qty,priceCentavos:price,oldPriceCentavos:oldPrice,
      oldQty,origem:countText_(raw.origem,100,false),cadastro:countText_(raw.cadastro,30,false)};
  });
}
function countInteger_(v,min,max) {
  if(v==null||v==='')return null;
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Valor de contagem/preço inválido');
  return n;
}
function countText_(v,max,mandatory) {
  const s=String(v==null?'':v).trim();
  if((mandatory&&!s)||s.length>max||/^[=+@-]/.test(s)||/[\x00-\x1f\x7f]/.test(s))
    throw Error('Texto inválido na contagem');
  return s;
}
function countOut_(obj,callback) {
  if(!callback)return countJson_(obj);
  if(!/^[A-Za-z_$][\w$]*$/.test(callback))return countJson_({ok:false,error:'Callback inválido'});
  return ContentService.createTextOutput(callback+'('+JSON.stringify(obj)+');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function countJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
