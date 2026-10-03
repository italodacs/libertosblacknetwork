/**
 * Recebe os formulários "Apoie" do site e grava numa planilha Google.
 *
 * Como publicar (uma vez, na conta libertosblacknetwork@gmail.com):
 *  1. Crie uma planilha nova no Google Sheets (ex.: "Site - Apoie").
 *  2. Extensões > Apps Script. Apague o conteúdo e cole este arquivo.
 *  3. Implantar > Nova implantação > tipo "App da Web".
 *     Executar como: Eu. Quem pode acessar: Qualquer pessoa.
 *  4. Autorize e copie a URL que termina em /exec.
 *  5. Cole essa URL em FORM_ENDPOINT, no final do HTML/index.html.
 *
 * Cada tipo de formulário vai para uma aba própria ("Empresas" e "Pessoas"),
 * criada automaticamente com cabeçalho no primeiro envio.
 */

var NOTIFY_EMAIL = 'libertosblacknetwork@gmail.com';

var COLUMNS = {
  empresa: ['empresa', 'nome', 'cargo', 'email', 'celular', 'interesse', 'mensagem', 'consentimento'],
  pessoa: ['nome', 'email', 'celular', 'perfil', 'estado', 'instituicao', 'area', 'participacao', 'mensagem', 'consentimento', 'banco_talentos']
};

var SHEET_NAMES = { empresa: 'Empresas', pessoa: 'Pessoas' };

function doPost(e) {
  var params = (e && e.parameters) || {};
  var tipo = first_(params.tipo);

  // Campo invisível "site": só robôs preenchem.
  if (first_(params.site) || !COLUMNS[tipo]) {
    return ContentService.createTextOutput('ignored');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheetFor_(tipo);
    var row = [new Date()].concat(COLUMNS[tipo].map(function (key) {
      return clean_((params[key] || []).join(', '));
    }));
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }

  notify_(tipo, params);
  return ContentService.createTextOutput('ok');
}

function sheetFor_(tipo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = SHEET_NAMES[tipo];
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['data'].concat(COLUMNS[tipo]));
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLUMNS[tipo].length + 1).setFontWeight('bold');
  }
  return sheet;
}

function notify_(tipo, params) {
  var titulo = tipo === 'empresa'
    ? 'Nova empresa quer apoiar: ' + first_(params.empresa)
    : 'Nova pessoa quer fazer parte: ' + first_(params.nome);
  var corpo = COLUMNS[tipo].map(function (key) {
    return key + ': ' + (params[key] || []).join(', ');
  }).join('\n');
  try {
    MailApp.sendEmail(NOTIFY_EMAIL, titulo, corpo + '\n\nRegistro completo na planilha.');
  } catch (err) {
    console.error('Falha ao enviar aviso por e-mail: ' + err);
  }
}

function first_(values) {
  return values && values.length ? String(values[0]) : '';
}

// Limita o tamanho e impede que um texto vire fórmula na planilha.
function clean_(value) {
  var text = String(value || '').slice(0, 2000);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
