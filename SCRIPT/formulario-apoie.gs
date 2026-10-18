/**
 * Recebe os formulários do site e grava numa planilha Google.
 *
 * Publicação manual: crie uma planilha > Extensões > Apps Script, cole este
 * arquivo e implante como App da Web, executando como proprietário, com acesso
 * público. Configure a URL /exec no frontend. Para atualizar sem mudar a URL:
 * Implantar > Gerenciar implantações > editar > Nova versão.
 * Autorize Sheets, Drive e Mail somente na conta responsável pelo serviço.
 *
 * Cada tipo tem sua aba; currículos ficam numa pasta privada no Drive.
 * A resposta de texto é mantida para compatibilidade: apenas "ok" confirma
 * persistência. Um cliente no-cors não consegue ler essa confirmação.
 * O lock serializa escritas, mas não fornece rate limiting nem idempotência.
 */

var NOTIFY_EMAIL = 'libertosblacknetwork@gmail.com';
var COLUMNS = {
  empresa: ['empresa', 'nome', 'cargo', 'email', 'celular', 'interesse', 'mensagem', 'consentimento'],
  pessoa: ['nome', 'email', 'celular', 'perfil', 'estado', 'instituicao', 'area', 'participacao', 'mensagem', 'consentimento', 'banco_talentos'],
  talento: ['nome', 'email', 'celular', 'linkedin', 'idade', 'genero', 'raca', 'estado', 'cidade', 'instituicao', 'curso', 'semestre', 'formatura', 'areas', 'curriculo', 'consentimento']
};
var REQUIRED = {
  empresa: ['empresa', 'nome', 'email', 'consentimento'],
  pessoa: ['nome', 'email', 'perfil', 'estado', 'consentimento'],
  talento: ['nome', 'email', 'celular', 'idade', 'genero', 'raca', 'estado', 'cidade', 'instituicao', 'curso', 'semestre', 'formatura', 'areas', 'consentimento']
};
var LIMITS = {
  empresa: 120, nome: 120, cargo: 120, email: 160, celular: 20, mensagem: 2000,
  perfil: 30, estado: 2, instituicao: 120, area: 120, linkedin: 200, idade: 2,
  genero: 40, raca: 30, cidade: 80, curso: 120, semestre: 30, formatura: 30,
  consentimento: 3, banco_talentos: 3, tipo: 7, site: 200, curriculo_tipo: 100
};
var OPTIONS = {
  perfil: ['Universitário(a)', 'Profissional', 'Outro'],
  estado: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE', 'AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO', 'DF', 'GO', 'MT', 'MS', 'ES', 'MG', 'RJ', 'SP', 'PR', 'RS', 'SC'],
  genero: ['Mulher', 'Homem', 'Pessoa não binária', 'Outra', 'Prefiro não informar'],
  raca: ['Preta', 'Parda', 'Branca', 'Amarela', 'Indígena', 'Prefiro não informar'],
  semestre: ['1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º', '10º', 'Acima do 10º', 'Já me formei'],
  formatura: ['2026', '2027', '2028', '2029', '2030', '2031 ou depois', 'Já me formei'],
  interesse: ['Patrocínio do Encontro', 'Programa de Voluntariado Corporativo', 'Banco de Talentos', 'Divulgação de vagas'],
  participacao: ['Entrar na rede', 'Ser mentor(a)', 'Ser voluntário(a) no Encontro', 'Receber a newsletter'],
  areas: ['Tecnologia', 'Dados', 'Marketing', 'Comunicação', 'Finanças', 'Administração', 'Direito', 'Engenharia', 'Saúde', 'Recursos Humanos', 'Outra']
};
var MULTIPLE = ['interesse', 'participacao', 'areas'];
var SHEET_NAMES = { empresa: 'Empresas', pessoa: 'Pessoas', talento: 'Banco de Talentos' };
var CV_FOLDER_NAME = 'Banco de Talentos - Currículos';
var CV_MAX_BYTES = 5 * 1024 * 1024;
var CV_TYPES = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
};

function doPost(e) {
  var raw = e && e.parameters;
  var tipo = raw && first_(raw.tipo);
  if (!owns_(COLUMNS, tipo)) return reply_('invalid request');
  var params = validate_(raw, tipo);
  if (!params) return reply_('invalid request');
  if (first_(params.site)) return reply_('ignored');

  // Validação/decodificação sem efeitos externos, antes de disputar o lock.
  var cv = tipo === 'talento' ? validateCv_(params) : null;
  if (tipo === 'talento' && !cv) return reply_('invalid file');
  var lock;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(10000);
  } catch (err) {
    console.error('submission_lock_unavailable');
    return reply_('busy');
  }

  var createdFile = null;
  var stored = false;
  var appendAttempted = false;
  try {
    var sheet = sheetFor_(tipo);
    if (cv) {
      createdFile = saveCv_(params, cv);
      params.curriculo = [createdFile.getUrl()];
    }
    var row = [new Date()].concat(COLUMNS[tipo].map(function (key) {
      return clean_((params[key] || []).join(', '));
    }));
    appendAttempted = true;
    sheet.appendRow(row);
    stored = true;
  } catch (err) {
    // Depois de iniciar appendRow, uma exceção não prova que a linha não existe.
    // Preservar o currículo evita apagar um arquivo que já pode estar referenciado;
    // o estado incerto precisa de reconciliação, não de exclusão automática.
    if (appendAttempted) {
      console.error('submission_write_outcome_unknown');
    } else if (createdFile) {
      // Só compensar antes de qualquer tentativa de gravar o cadastro.
      try { createdFile.setTrashed(true); }
      catch (cleanupError) { console.error('submission_file_cleanup_failed'); }
    }
    console.error('submission_write_failed');
  } finally {
    try { lock.releaseLock(); }
    catch (releaseError) { console.error('submission_lock_release_failed'); }
  }
  if (!stored) return reply_('error');
  notify_(tipo, params);
  return reply_('ok');
}

function validate_(raw, tipo) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  var allowed = COLUMNS[tipo].filter(function (key) { return key !== 'curriculo'; })
    .concat(['tipo', 'site']);
  if (tipo === 'talento') allowed = allowed.concat(['curriculo_tipo', 'curriculo_b64']);
  var keys = Object.keys(raw);
  if (keys.length > allowed.length) return null;
  var params = {};
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (allowed.indexOf(key) === -1) return null;
    var values = raw[key];
    var multiple = MULTIPLE.indexOf(key) !== -1;
    var maxCount = multiple ? OPTIONS[key].length : 1;
    if (!Array.isArray(values) || !values.length || values.length > maxCount) return null;
    var limit = key === 'curriculo_b64' ? 4 * Math.ceil(CV_MAX_BYTES / 3) :
      (multiple ? 80 : LIMITS[key]);
    params[key] = [];
    for (var j = 0; j < values.length; j++) {
      if (typeof values[j] !== 'string' || values[j].length > limit) return null;
      var value = key === 'curriculo_b64' ? values[j] : values[j].trim();
      if (owns_(OPTIONS, key) && value && OPTIONS[key].indexOf(value) === -1) return null;
      if (multiple && (!value || params[key].indexOf(value) !== -1)) return null;
      params[key].push(value);
    }
  }
  if (first_(params.tipo) !== tipo) return null;
  for (var r = 0; r < REQUIRED[tipo].length; r++) {
    if (!first_(params[REQUIRED[tipo][r]])) return null;
  }
  if (first_(params.consentimento) !== 'sim') return null;
  if (params.banco_talentos && first_(params.banco_talentos) !== 'sim') return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(first_(params.email))) return null;
  if (tipo === 'talento') {
    var age = first_(params.idade);
    if (!/^\d{2}$/.test(age) || Number(age) < 14 || Number(age) > 99) return null;
    var linkedin = first_(params.linkedin);
    if (linkedin && !/^https?:\/\/[^\s/]+(?:[/?#][^\s]*)?$/i.test(linkedin)) return null;
  }
  return params;
}

function validateCv_(params) {
  var mime = first_(params.curriculo_tipo);
  var data = first_(params.curriculo_b64);
  if (!owns_(CV_TYPES, mime) || !data || data.length > 4 * Math.ceil(CV_MAX_BYTES / 3)) return null;
  if (data.length % 4 || /[^A-Za-z0-9+/=]/.test(data)) return null;
  var padding = data.endsWith('==') ? 2 : (data.endsWith('=') ? 1 : 0);
  var paddingAt = data.indexOf('=');
  if (paddingAt !== -1 && paddingAt !== data.length - padding) return null;
  if (data.length / 4 * 3 - padding > CV_MAX_BYTES) return null;
  var bytes;
  try { bytes = Utilities.base64Decode(data); } catch (err) { return null; }
  if (!bytes.length || bytes.length > CV_MAX_BYTES) return null;
  // Assinaturas básicas detectam formato incompatível, não conteúdo malicioso.
  // DOCX usa contêiner ZIP: isto não valida seu XML interno nem faz antivírus.
  var signatures = {
    pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
    doc: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    docx: [0x50, 0x4b, 0x03, 0x04]
  };
  var ext = CV_TYPES[mime];
  var signature = signatures[ext];
  if (bytes.length < signature.length) return null;
  for (var i = 0; i < signature.length; i++) {
    if ((bytes[i] & 255) !== signature[i]) return null;
  }
  return { bytes: bytes, mime: mime, ext: ext };
}

function sheetFor_(tipo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = SHEET_NAMES[tipo];
  var expected = ['data'].concat(COLUMNS[tipo]);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(expected);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, expected.length).setFontWeight('bold');
  }
  // Não migrar nem recriar cabeçalhos de abas existentes durante uma submissão.
  // getLastColumn considera células com conteúdo, não colunas vazias alocadas.
  // A verificação ocorre sob o lock, antes de criar currículo ou gravar cadastro.
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() !== expected.length) {
    throw new Error('submission_schema_mismatch');
  }
  var header = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  for (var i = 0; i < expected.length; i++) {
    if (header[i] !== expected[i]) throw new Error('submission_schema_mismatch');
  }
  return sheet;
}

function notify_(tipo, params) {
  var titulo = {
    empresa: 'Nova empresa quer apoiar: ',
    pessoa: 'Nova pessoa quer fazer parte: ',
    talento: 'Novo cadastro no Banco de Talentos: '
  }[tipo] + first_(params[tipo === 'empresa' ? 'empresa' : 'nome']).replace(/[\r\n]/g, ' ');
  var corpo = COLUMNS[tipo].map(function (key) {
    return key + ': ' + (params[key] || []).join(', ');
  }).join('\n');
  try {
    MailApp.sendEmail(NOTIFY_EMAIL, titulo, corpo + '\n\nRegistro completo na planilha.');
  } catch (err) {
    // Não registrar erro externo bruto, que pode conter dados pessoais.
    console.error('submission_notification_failed');
  }
}

function saveCv_(params, cv) {
  var nome = first_(params.nome).replace(/[^\wÀ-ÿ ]+/g, '').trim().slice(0, 80) || 'sem-nome';
  var stamp = Utilities.formatDate(new Date(), 'America/Bahia', 'yyyy-MM-dd HHmm');
  var blob = Utilities.newBlob(cv.bytes, cv.mime, nome + ' - ' + stamp + '.' + cv.ext);
  return cvFolder_().createFile(blob);
}

// Executada somente com o lock de submissão adquirido.
function cvFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CV_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  // Falha ao acessar uma pasta configurada deve ser investigada pelo operador;
  // recriá-la silenciosamente poderia espalhar currículos em pastas diferentes.
  var folder = DriveApp.createFolder(CV_FOLDER_NAME);
  props.setProperty('CV_FOLDER_ID', folder.getId());
  return folder;
}

function owns_(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function first_(values) {
  return Array.isArray(values) && values.length && typeof values[0] === 'string' ? values[0] : '';
}

function reply_(text) {
  return ContentService.createTextOutput(text);
}

function clean_(value) {
  var text = String(value || '').slice(0, 2000);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
