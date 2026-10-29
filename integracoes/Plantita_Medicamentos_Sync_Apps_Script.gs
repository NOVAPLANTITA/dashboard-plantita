/**
 * PLANTITA — Ponte de codigos de medicamentos (projeto SEPARADO do Granel).
 * Implantar como Aplicativo da Web (executar como proprietário).
 * Propriedades do script: MED_SYNC_TOKEN = chave longa e privada criada pelo dono.
 * URL de implantação /exec e chave devem ser informadas apenas dentro do PDV.
 * NUNCA publicar a chave no GitHub nem incluir neste arquivo.
 */
const MED_SHEET_ID = '1Y-CNO7lo5CHZEHZ3-AHX1Se4ubdTQCCtQS3jOQPS6fU';
const MED_TAB = 'Codigos_Medicamentos';
const MED_COLUMNS = 9;
const MED_MAX_ROWS_READ = 5000;

function doGet(e) {
  const p = (e && e.parameter) || {};
  const callback = String(p.callback || '');
  try {
    autenticarMed_(p.key);
    if (p.action !== 'links') throw new Error('Ação desconhecida.');
    const sh = folhaMed_();
    const last = Math.min(sh.getLastRow(), MED_MAX_ROWS_READ + 1);
    const rows = last > 1 ? sh.getRange(2, 1, last - 1, MED_COLUMNS).getDisplayValues() : [];
    const links = rows.filter(r => r[0]).map(r => ({
      ean: String(r[0]), ultimos6: String(r[1]), codigoDanfe: String(r[2]),
      produto: String(r[3]), produtoId: String(r[4]), situacao: String(r[5]),
      confirmadoEm: String(r[6])
    }));
    return saidaMed_({ok:true, action:'links', links:links, generatedAt:new Date().toISOString()}, callback);
  } catch (err) {
    return saidaMed_({ok:false, error:String(err.message || err)}, callback);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    autenticarMed_(body.key);
    if (body.action !== 'upsert') throw new Error('Ação desconhecida.');
    const ean = String(body.ean || '').trim();
    const produto = limparMed_(body.produto, 220);
    const produtoId = limparMed_(body.produtoId, 100);
    const codigoDanfe = String(body.codigoDanfe || '').trim();
    if (!validarEanMed_(ean) || /^2\d{12}$/.test(ean)) throw new Error('EAN inválido ou etiqueta de balança.');
    if (!produto || !produtoId) throw new Error('Nome e identificador do produto são obrigatórios.');
    if (codigoDanfe && !/^\d{3,14}$/.test(codigoDanfe)) throw new Error('Código DANFE inválido.');
    const sh = folhaMed_();
    const last = sh.getLastRow();
    const lines = last > 1 ? sh.getRange(2,1,last-1,MED_COLUMNS).getDisplayValues() : [];
    const existingIdx = lines.findIndex(row => String(row[0]) === ean);
    if (existingIdx >= 0) {
      const row = lines[existingIdx];
      const oldProduto = String(row[3]), oldId = String(row[4]), oldDanfe = String(row[2]);
      // Não sobrescrever vínculos diferentes sem revisão humana.
      if ((oldId && oldId !== produtoId) || (oldProduto && normMed_(oldProduto) !== normMed_(produto)) ||
          (oldDanfe && codigoDanfe && oldDanfe !== codigoDanfe)) {
        throw new Error('Conflito: EAN já pertence a outro medicamento. Corrija a planilha após conferência.');
      }
      if (row[5] !== 'Confirmado') throw new Error('EAN está em revisão/inativo. Conferir antes de reutilizar.');
      return jsonMed_({ok:true, status:'already_exists', ean:ean});
    }
    if (last >= sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    const now = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss');
    const row = [ean, ean.slice(-6), codigoDanfe, produto, produtoId,
      'Confirmado', now, 'PDV bipagem confirmada', ''];
    const next = sh.getLastRow()+1;
    sh.getRange(next,1,1,MED_COLUMNS).setNumberFormat('@').setValues([row]);
    return jsonMed_({ok:true, status:'created', ean:ean, row:next});
  } catch (err) {
    return jsonMed_({ok:false,error:String(err.message||err)});
  } finally {
    lock.releaseLock();
  }
}

function autenticarMed_(key) {
  const secret = PropertiesService.getScriptProperties().getProperty('MED_SYNC_TOKEN');
  if (!secret || secret.length < 20) throw new Error('MED_SYNC_TOKEN não configurado no Apps Script.');
  if (String(key || '') !== secret) throw new Error('Chave de acesso inválida.');
}

function folhaMed_() {
  const sh = SpreadsheetApp.openById(MED_SHEET_ID).getSheetByName(MED_TAB);
  if (!sh) throw new Error('Aba Codigos_Medicamentos não encontrada.');
  return sh;
}
function normMed_(s) {
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
}
function limparMed_(s,max) {
  let x=String(s||'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);
  if (/^[=+@-]/.test(x)) throw new Error('Texto começa com caractere reservado de fórmula.');
  return x;
}
function validarEanMed_(v) {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(v)) return false;
  const arr=v.split('').map(Number), check=arr.pop();
  let sum=0;
  for(let i=arr.length-1,j=0;i>=0;i--,j++)sum+=arr[i]*(j%2===0?3:1);
  return (10-(sum%10))%10===check;
}
function saidaMed_(obj, callback) {
  if (!callback) return jsonMed_(obj);
  if (!/^[a-zA-Z_$][\w$]*$/.test(callback)) return jsonMed_({ok:false,error:'Callback inválido'});
  return ContentService.createTextOutput(callback+'('+JSON.stringify(obj)+');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function jsonMed_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
