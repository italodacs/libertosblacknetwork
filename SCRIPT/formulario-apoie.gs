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
 * Cada tipo de formulário vai para uma aba própria ("Empresas", "Pessoas" e
 * "Banco de Talentos"), criada automaticamente com cabeçalho no primeiro envio.
 *
 * Banco de Talentos (HTML/talentos.html): o currículo chega em base64 e é salvo
 * na pasta do Drive CV_FOLDER_NAME (criada no primeiro envio, privada da conta).
 * A planilha guarda o link do arquivo. Ao atualizar este script, use
 * Implantar > Gerenciar implantações > editar > Nova versão, para manter a URL,
 * e autorize o acesso ao Drive quando o Google pedir.
 */

var NOTIFY_EMAIL = 'libertosblacknetwork@gmail.com';

var COLUMNS = {
  empresa: ['empresa', 'nome', 'cargo', 'email', 'celular', 'interesse', 'mensagem', 'consentimento'],
  pessoa: ['nome', 'email', 'celular', 'perfil', 'estado', 'instituicao', 'area', 'participacao', 'mensagem', 'consentimento', 'banco_talentos'],
  talento: ['nome', 'email', 'celular', 'linkedin', 'idade', 'genero', 'raca', 'estado', 'cidade', 'instituicao', 'curso', 'semestre', 'formatura', 'areas', 'curriculo', 'consentimento']
};

var SHEET_NAMES = { empresa: 'Empresas', pessoa: 'Pessoas', talento: 'Banco de Talentos' };

var CV_FOLDER_NAME = 'Banco de Talentos - Currículos';
var CV_MAX_BYTES = 5 * 1024 * 1024;
var CV_TYPES = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
};

function doPost(e) {
  var params = (e && e.parameters) || {};
  var tipo = first_(params.tipo);

  // Campo invisível "site": só robôs preenchem.
  if (first_(params.site) || !COLUMNS[tipo]) {
    return ContentService.createTextOutput('ignored');
  }

  if (tipo === 'talento') {
    var link = saveCv_(params);
    if (!link) return ContentService.createTextOutput('invalid file');
    params.curriculo = [link];
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
  var titulo = {
    empresa: 'Nova empresa quer apoiar: ' + first_(params.empresa),
    pessoa: 'Nova pessoa quer fazer parte: ' + first_(params.nome),
    talento: 'Novo cadastro no Banco de Talentos: ' + first_(params.nome)
  }[tipo];
  var corpo = COLUMNS[tipo].map(function (key) {
    return key + ': ' + (params[key] || []).join(', ');
  }).join('\n');
  try {
    MailApp.sendEmail(NOTIFY_EMAIL, titulo, corpo + '\n\nRegistro completo na planilha.');
  } catch (err) {
    console.error('Falha ao enviar aviso por e-mail: ' + err);
  }
}

// Salva o currículo no Drive e devolve o link; vazio se o arquivo for inválido.
function saveCv_(params) {
  var mime = first_(params.curriculo_tipo);
  var ext = CV_TYPES[mime];
  var data = first_(params.curriculo_b64);
  if (!ext || !data) return '';
  var bytes = Utilities.base64Decode(data);
  if (bytes.length > CV_MAX_BYTES) return '';
  var nome = first_(params.nome).replace(/[^\wÀ-ÿ ]+/g, '').trim().slice(0, 80) || 'sem-nome';
  var stamp = Utilities.formatDate(new Date(), 'America/Bahia', 'yyyy-MM-dd HHmm');
  var blob = Utilities.newBlob(bytes, mime, nome + ' - ' + stamp + '.' + ext);
  return cvFolder_().createFile(blob).getUrl();
}

function cvFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CV_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* pasta apagada: cria outra */ }
  }
  var folder = DriveApp.createFolder(CV_FOLDER_NAME);
  props.setProperty('CV_FOLDER_ID', folder.getId());
  return folder;
}

function first_(values) {
  return values && values.length ? String(values[0]) : '';
}

// Limita o tamanho e impede que um texto vire fórmula na planilha.
function clean_(value) {
  var text = String(value || '').slice(0, 2000);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
