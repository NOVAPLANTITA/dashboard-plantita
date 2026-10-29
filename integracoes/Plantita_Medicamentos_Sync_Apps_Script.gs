/**
 * PLANTITA — Ponte central de códigos e preços de medicamentos.
 * Projeto SEPARADO do Granel. Executar como proprietário.
 * Configurar MED_SYNC_TOKEN em Propriedades do Script (nunca publicar a chave).
 * Atualize a implantação do App da Web para uma NOVA VERSÃO após colar este código.
 * Colunas A:I preservadas; J = preço de venda em R$, K = atualização, L = origem.
 */
const MED_SHEET_ID = '1Y-CNO7lo5CHZEHZ3-AHX1Se4ubdTQCCtQS3jOQPS6fU';
const MED_TAB = 'Codigos_Medicamentos';
const MED_COLUMNS = 12;
const MED_MAX_ROWS_READ = 5000;

function doGet(e) {
  const p = (e && e.parameter) || {};
  const callback = String(p.callback || '');
  try {
    autenticarMed_(p.key);
    if (p.action !== 'links') throw new Error('Ação desconhecida.');
    const sh = folhaMed_();
    const last = Math.min(sh.getLastRow(), MED_MAX_ROWS_READ + 1);
    const n = Math.max(0,last-1);
    const display = n ? sh.getRange(2,1,n,MED_COLUMNS).getDisplayValues() : [];
    const rawPrices = n ? sh.getRange(2,10,n,1).getValues() : [];
    const links = display.filter(r => r[0]).map(r => {
      // Os índices do preço são os mesmos da leitura integral, mesmo com outras linhas vazias.
      const idx = display.indexOf(r);
      const cents = precoDaCelulaMed_(rawPrices[idx][0]);
      return {
        ean:String(r[0]),ultimos6:String(r[1]),codigoDanfe:String(r[2]),
        produto:String(r[3]),produtoId:String(r[4]),situacao:String(r[5]),
        confirmadoEm:String(r[6]),precoCentavos:cents,
        precoAtualizadoEm:String(r[10]||''),origemPreco:String(r[11]||'')
      };
    });
    return saidaMed_({ok:true,action:'links',links:links,
      generatedAt:new Date().toISOString(),schema:2},callback);
  } catch(err) {
    return saidaMed_({ok:false,error:String(err.message||err)},callback);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body=JSON.parse((e && e.postData && e.postData.contents)||'{}');
    autenticarMed_(body.key);
    const action=String(body.action||'');
    if (action!=='upsert' && action!=='set_price') throw new Error('Ação desconhecida.');
    const ean=String(body.ean||'').trim();
    const produto=limparMed_(body.produto,220);
    const produtoId=limparMed_(body.produtoId,100);
    const codigoDanfe=String(body.codigoDanfe||'').trim();
    if(!validarEanMed_(ean)||/^2\d{12}$/.test(ean))throw new Error('EAN inválido ou etiqueta de balança.');
    if(!produto||!produtoId)throw new Error('Nome e identificador do produto são obrigatórios.');
    if(codigoDanfe&&!/^\d{3,14}$/.test(codigoDanfe))throw new Error('Código DANFE inválido.');
    const cents=validarPrecoMed_(body.precoCentavos);
    if(action==='set_price'&&cents===null)throw new Error('Informe um preço válido para atualizar.');
    if(action==='set_price'&&!Object.prototype.hasOwnProperty.call(body,'precoEsperadoCentavos'))
      throw new Error('É necessário informar o preço anterior para prevenir conflito.');
    const expected=action==='set_price'?validarPrecoMed_(body.precoEsperadoCentavos):null;
    const sh=folhaMed_();
    if(sh.getMaxColumns()<MED_COLUMNS)throw new Error('Planilha sem as colunas J:L para preços.');
    const last=sh.getLastRow();
    const rows=last>1?sh.getRange(2,1,last-1,MED_COLUMNS).getDisplayValues():[];
    const existingIdx=rows.findIndex(r=>String(r[0])===ean);
    const now=Utilities.formatDate(new Date(),'America/Sao_Paulo','yyyy-MM-dd HH:mm:ss');
    if(existingIdx>=0){
      const r=rows[existingIdx];
      const oldProduto=String(r[3]),oldId=String(r[4]),oldDanfe=String(r[2]);
      if((oldId&&oldId!==produtoId)||(oldProduto&&normMed_(oldProduto)!==normMed_(produto))||
         (oldDanfe&&codigoDanfe&&oldDanfe!==codigoDanfe))
        throw new Error('Conflito: EAN já pertence a outro medicamento. Confira a planilha.');
      if(r[5]!=='Confirmado')throw new Error('EAN em revisão ou inativo.');
      const rowIndex=existingIdx+2;
      const oldCents=precoDaCelulaMed_(sh.getRange(rowIndex,10).getValue());
      if(action==='set_price'){
        if(oldCents!==expected)
          throw new Error('Conflito de preço: o valor mudou em outro computador. Atualize o PDV e confira.');
        if(oldCents!==cents)gravarPrecoMed_(sh,rowIndex,cents,now,'PDV: preço alterado');
        return jsonMed_({ok:true,status:oldCents===cents?'unchanged':'price_updated',ean:ean});
      }
      if(cents!==null){
        if(oldCents!==null&&oldCents!==cents)
          throw new Error('Conflito: já existe outro preço. Use Alterar preço após consultar o Google.');
        if(oldCents===null)gravarPrecoMed_(sh,rowIndex,cents,now,'PDV: preço informado');
      }
      return jsonMed_({ok:true,status:'already_exists',ean:ean});
    }
    if(action==='set_price')throw new Error('EAN não existe: confirme o vínculo antes de alterar o preço.');
    if(last>=sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),500);
    const rowIndex=sh.getLastRow()+1;
    const row=[ean,ean.slice(-6),codigoDanfe,produto,produtoId,'Confirmado',now,
      'PDV bipagem confirmada','',cents===null?'':cents/100,
      cents===null?'':now,cents===null?'':'PDV: cadastro com preço'];
    sh.getRange(rowIndex,1,1,9).setNumberFormat('@');
    sh.getRange(rowIndex,1,1,MED_COLUMNS).setValues([row]);
    sh.getRange(rowIndex,10).setNumberFormat('"R$" #,##0.00');
    return jsonMed_({ok:true,status:'created',ean:ean,row:rowIndex});
  } catch(err) {
    return jsonMed_({ok:false,error:String(err.message||err)});
  } finally {
    lock.releaseLock();
  }
}

function gravarPrecoMed_(sh,rowIndex,cents,now,origem) {
  const cell=sh.getRange(rowIndex,10);
  cell.setNumberFormat('"R$" #,##0.00');
  sh.getRange(rowIndex,10,1,3).setValues([[cents/100,now,origem]]);
}
function validarPrecoMed_(raw) {
  if(raw===null||raw===undefined||raw==='')return null;
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<1||n>100000000)
    throw new Error('Preço de venda inválido (informe centavos inteiros).');
  return n;
}
function precoDaCelulaMed_(raw) {
  if(raw===null||raw===undefined||raw==='')return null;
  const num=typeof raw==='number'?raw:
    Number(String(raw).replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.'));
  if(!Number.isFinite(num)||num<=0)return null;
  const n=Math.round(num*100);
  return n>=1&&n<=100000000?n:null;
}
function autenticarMed_(key) {
  const secret=PropertiesService.getScriptProperties().getProperty('MED_SYNC_TOKEN');
  if(!secret||secret.length<20)throw new Error('MED_SYNC_TOKEN não configurado no Apps Script.');
  if(String(key||'')!==secret)throw new Error('Chave de acesso inválida.');
}
function folhaMed_() {
  const sh=SpreadsheetApp.openById(MED_SHEET_ID).getSheetByName(MED_TAB);
  if(!sh)throw new Error('Aba Codigos_Medicamentos não encontrada.');
  return sh;
}
function normMed_(s) {
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\s+/g,' ').trim().toLowerCase();
}
function limparMed_(s,max) {
  const x=String(s||'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);
  if(/^[=+@-]/.test(x))throw new Error('Texto começa com caractere reservado de fórmula.');
  return x;
}
function validarEanMed_(v) {
  if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(v))return false;
  const a=v.split('').map(Number),check=a.pop();
  let sum=0;
  for(let i=a.length-1,j=0;i>=0;i--,j++)sum+=a[i]*(j%2===0?3:1);
  return (10-(sum%10))%10===check;
}
function saidaMed_(obj,callback) {
  if(!callback)return jsonMed_(obj);
  if(!/^[a-zA-Z_$][\w$]*$/.test(callback))
    return jsonMed_({ok:false,error:'Callback inválido'});
  return ContentService.createTextOutput(callback+'('+JSON.stringify(obj)+');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function jsonMed_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
