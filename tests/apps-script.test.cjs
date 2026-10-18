const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../SCRIPT/formulario-apoie.gs'), 'utf8');
const pdf = Buffer.from('%PDF-1.4\nsynthetic-test');
const base = { nome: 'Pessoa de Teste', email: 'synthetic@example.test', consentimento: 'sim', site: '' };
const fixtures = {
  empresa: { ...base, tipo: 'empresa', empresa: 'Empresa de Teste' },
  pessoa: { ...base, tipo: 'pessoa', perfil: 'Universitário(a)', estado: 'BA' },
  talento: {
    ...base, tipo: 'talento', celular: '71999999999', idade: '21', genero: 'Prefiro não informar',
    raca: 'Prefiro não informar', estado: 'BA', cidade: 'Salvador', instituicao: 'Instituição de Teste',
    curso: 'Curso de Teste', semestre: '4º', formatura: '2028', areas: ['Tecnologia', 'Dados'],
    curriculo_tipo: 'application/pdf', curriculo_b64: pdf.toString('base64')
  }
};

// Google services are local doubles. The harness has no HTTP client or credentials.
function setup(options = {}) {
  const state = { rows: [], files: [], folders: [], emails: [], events: [], logs: [], decodeCalls: 0, held: false,
    header: null, headerReads: 0, sheetsCreated: 0 };
  const properties = { ...options.properties };
  const requireLock = () => assert.equal(state.held, true, 'mutations require the script lock');
  const sheet = {
    appendRow(row) {
      requireLock();
      if (options.sheetFails) throw new Error('synthetic sensitive upstream detail');
      if (state.header === null) state.header = Array.from(row);
      state.rows.push(Array.from(row));
      state.events.push('row');
      if (options.sheetWritesThenFails) throw new Error('synthetic sensitive upstream detail');
    },
    getLastRow: () => options.lastRow ?? (state.header === null ? 0 : 1 + state.rows.length),
    getLastColumn: () => options.lastColumn ?? (state.header === null ? 0 : state.header.length),
    setFrozenRows() { requireLock(); },
    getRange(row, column, rows, columns) {
      assert.deepEqual([row, column, rows], [1, 1, 1]);
      return {
        setFontWeight() { requireLock(); },
        getValues() {
          requireLock();
          state.headerReads++;
          if (options.headerReadFails) throw new Error('synthetic sensitive upstream detail');
          return [state.header.slice(0, columns)];
        }
      };
    }
  };
  let sheetExists = !options.missingSheet;
  const folder = {
    getId: () => 'synthetic-folder',
    createFile(blob) {
      requireLock();
      if (options.fileFails) throw new Error('synthetic sensitive upstream detail');
      const file = {
        blob, trashed: false,
        getUrl() {
          if (options.fileUrlFails) throw new Error('synthetic sensitive upstream detail');
          return 'https://drive.example.test/file/synthetic';
        },
        setTrashed(value) {
          requireLock();
          if (options.cleanupFails) throw new Error('synthetic sensitive upstream detail');
          this.trashed = value;
          state.events.push('trash');
        }
      };
      state.files.push(file);
      state.events.push('file');
      return file;
    }
  };
  const sandbox = {
    console: { error: value => state.logs.push(value) },
    ContentService: { createTextOutput: text => ({ text }) },
    LockService: {
      getScriptLock() {
        if (options.lockServiceFails) throw new Error('synthetic sensitive upstream detail');
        return {
          waitLock() {
            if (options.lockFails) throw new Error('synthetic sensitive upstream detail');
            state.held = true;
            state.events.push('lock');
          },
          releaseLock() {
            state.held = false;
            state.events.push('release');
            if (options.releaseFails) throw new Error('synthetic sensitive upstream detail');
          }
        };
      }
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName(name) {
        if (!sheetExists) return null;
        if (state.header === null) {
          const tipo = Object.keys(sandbox.SHEET_NAMES).find(key => sandbox.SHEET_NAMES[key] === name);
          const expected = ['data', ...sandbox.COLUMNS[tipo]];
          state.header = options.header ? options.header(expected) : expected;
        }
        return sheet;
      },
      insertSheet() { requireLock(); state.sheetsCreated++; sheetExists = true; return sheet; }
    }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties[key],
      setProperty(key, value) { requireLock(); properties[key] = value; }
    }) },
    DriveApp: {
      createFolder() { requireLock(); state.folders.push(folder); return folder; },
      getFolderById() {
        if (options.folderFails) throw new Error('synthetic sensitive upstream detail');
        return folder;
      }
    },
    MailApp: { sendEmail(to, subject, body) {
      assert.equal(state.held, false, 'email must not extend the write lock');
      if (options.mailFails) throw new Error('synthetic sensitive upstream detail');
      state.emails.push({ to, subject, body });
    } },
    Utilities: {
      base64Decode(data) {
        state.decodeCalls++;
        if (options.decodeFails) throw new Error('synthetic sensitive upstream detail');
        // Apps Script bytes can be signed: preserve that behavior in the test.
        return Array.from(new Int8Array(Buffer.from(data, 'base64')));
      },
      formatDate: () => '2026-10-17 1200',
      newBlob: (bytes, mime, name) => ({ bytes, mime, name })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'formulario-apoie.gs' });
  const post = input => sandbox.doPost({ parameters: Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
  ) }).text;
  return { state, sandbox, post };
}

function assertRejected(input, expected = 'invalid request', options = {}) {
  const env = setup(options);
  assert.equal(env.post(input), expected);
  assert.equal(env.state.rows.length, 0);
  assert.equal(env.state.files.length, 0);
  assert.equal(env.state.emails.length, 0);
  return env;
}

for (const tipo of Object.keys(fixtures)) {
  test(`accepts valid ${tipo} with the existing text response and column layout`, () => {
    const env = setup();
    assert.equal(env.post(fixtures[tipo]), 'ok');
    assert.equal(env.state.rows.length, 1);
    assert.equal(env.state.rows[0].length, env.sandbox.COLUMNS[tipo].length + 1);
    assert.equal(env.state.emails.length, 1);
    assert.equal(env.state.files.length, tipo === 'talento' ? 1 : 0);
    assert.equal(env.state.headerReads, 1);
    assert.equal(env.state.held, false);
  });
  test(`rejects every missing required ${tipo} field before side effects`, () => {
    const env = setup();
    for (const field of env.sandbox.REQUIRED[tipo]) {
      const input = { ...fixtures[tipo] };
      delete input[field];
      assertRejected(input);
      assertRejected({ ...fixtures[tipo], [field]: '   ' });
    }
  });
}

test('rejects absent or inherited form types without exceptions', () => {
  for (const tipo of ['', 'toString', '__proto__', 'constructor', 'unknown']) assertRejected({ tipo });
  const env = setup();
  assert.equal(env.sandbox.doPost().text, 'invalid request');
  assert.equal(env.sandbox.doPost({ parameters: { tipo: 'pessoa' } }).text, 'invalid request');
});

test('requires exact consent and rejects unrecognized fields', () => {
  for (const consentimento of ['não', 'true', '1']) assertRejected({ ...fixtures.pessoa, consentimento });
  assertRejected({ ...fixtures.pessoa, banco_talentos: 'não' });
  assertRejected({ ...fixtures.pessoa, extra: 'unexpected' });
  assertRejected({ ...fixtures.talento, curriculo: 'https://untrusted.example.test/' });
});

test('rejects invalid enums, duplicate values and oversized arrays', () => {
  assertRejected({ ...fixtures.pessoa, estado: 'XX' });
  assertRejected({ ...fixtures.pessoa, perfil: 'unknown' });
  assertRejected({ ...fixtures.talento, areas: ['unknown'] });
  assertRejected({ ...fixtures.talento, areas: ['Dados', 'Dados'] });
  assertRejected({ ...fixtures.talento, areas: Array(12).fill('Dados') });
  assertRejected({ ...fixtures.pessoa, nome: ['first', 'second'] });
  assertRejected({ ...fixtures.pessoa, nome: [] });
  assertRejected({ ...fixtures.pessoa, nome: 123 });
});

test('accepts valid optional repeated fields and trims text before storing', () => {
  const env = setup();
  assert.equal(env.post({ ...fixtures.empresa, nome: '  Pessoa de Teste  ', interesse: ['Patrocínio do Encontro', 'Banco de Talentos'], cargo: '', celular: '' }), 'ok');
  assert.equal(env.state.rows[0][2], 'Pessoa de Teste');
  assert.ok(env.state.rows[0].includes('Patrocínio do Encontro, Banco de Talentos'));
});

test('enforces length, email, age and URL constraints', () => {
  assertRejected({ ...fixtures.pessoa, nome: 'x'.repeat(121) });
  assertRejected({ ...fixtures.pessoa, mensagem: 'x'.repeat(2001) });
  for (const email of ['missing-at', 'a@', 'a b@example.test', 'a@example.test\nx']) assertRejected({ ...fixtures.pessoa, email });
  for (const idade of ['13', '100', '1.5', '-1', '20x']) assertRejected({ ...fixtures.talento, idade });
  assertRejected({ ...fixtures.talento, linkedin: 'javascript:alert(1)' });
  assertRejected({ ...fixtures.talento, linkedin: 'https://' });
});

test('ignores a populated honeypot without writing or sending email', () => {
  assertRejected({ ...fixtures.pessoa, site: 'spam.example.test' }, 'ignored');
});

test('rejects inherited, unsupported, or missing MIME before decode', () => {
  for (const curriculo_tipo of ['toString', '__proto__', 'constructor', 'text/html', '']) {
    const env = assertRejected({ ...fixtures.talento, curriculo_tipo }, 'invalid file');
    assert.equal(env.state.decodeCalls, 0);
  }
});

test('rejects malformed or empty base64 before decode', () => {
  for (const curriculo_b64 of ['', '!', 'AAAAA', 'AAAA\nAAA', 'AAAA====', 'A=AA', '====', 'AAA=AAAA']) {
    const env = assertRejected({ ...fixtures.talento, curriculo_b64 }, 'invalid file');
    assert.equal(env.state.decodeCalls, 0);
  }
});

test('rejects oversized encoded and decoded lengths before decode', () => {
  const encoded = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');
  const env = assertRejected({ ...fixtures.talento, curriculo_b64: encoded }, 'invalid file');
  assert.equal(env.state.decodeCalls, 0);
  const tooLong = assertRejected({ ...fixtures.talento, curriculo_b64: encoded + 'AAAA' });
  assert.equal(tooLong.state.decodeCalls, 0);
});

test('accepts a PDF exactly at the documented 5 MiB limit', () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024);
  pdf.copy(bytes);
  const env = setup();
  assert.equal(env.post({ ...fixtures.talento, curriculo_b64: bytes.toString('base64') }), 'ok');
  assert.equal(env.state.files[0].blob.bytes.length, 5 * 1024 * 1024);
});

test('handles decoder exceptions and incompatible file signatures', () => {
  assertRejected(fixtures.talento, 'invalid file', { decodeFails: true });
  for (const bytes of [Buffer.from('not a PDF'), Buffer.from('%PDF'), Buffer.from([1])]) {
    assertRejected({ ...fixtures.talento, curriculo_b64: bytes.toString('base64') }, 'invalid file');
  }
});

test('supports signed DOC bytes and the basic DOCX ZIP signature', () => {
  for (const [curriculo_tipo, bytes] of [
    ['application/msword', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from([0x50, 0x4b, 0x03, 0x04])]
  ]) {
    const env = setup();
    assert.equal(env.post({ ...fixtures.talento, curriculo_tipo, curriculo_b64: bytes.toString('base64') }), 'ok');
    assert.equal(env.state.files[0].blob.mime, curriculo_tipo);
  }
});

test('lock timeout never creates a folder, file, row or notification', () => {
  const env = assertRejected(fixtures.talento, 'busy', { lockFails: true });
  assert.equal(env.state.folders.length, 0);
  assert.deepEqual(env.state.events, []);
});

test('lock service failure returns a bounded error', () => {
  assertRejected(fixtures.talento, 'busy', { lockServiceFails: true });
});

test('append failure before writing preserves the CV because the service outcome is unknown', () => {
  const env = setup({ sheetFails: true });
  assert.equal(env.post(fixtures.talento), 'error');
  assert.equal(env.state.rows.length, 0);
  assert.equal(env.state.files.length, 1);
  assert.equal(env.state.files[0].trashed, false);
  assert.deepEqual(env.state.events, ['lock', 'file', 'release']);
  assert.deepEqual(env.state.logs, ['submission_write_outcome_unknown', 'submission_write_failed']);
  assert.equal(env.state.emails.length, 0);
});

for (const tipo of Object.keys(fixtures)) {
  test(`${tipo}: append commits then throws without reporting success, notifying or deleting the CV`, () => {
    const env = setup({ sheetWritesThenFails: true });
    assert.equal(env.post(fixtures[tipo]), 'error');
    assert.equal(env.state.rows.length, 1);
    assert.equal(env.state.emails.length, 0);
    assert.equal(env.state.held, false);
    assert.deepEqual(env.state.logs, ['submission_write_outcome_unknown', 'submission_write_failed']);
    assert.equal(env.state.events.includes('trash'), false);
    if (tipo === 'talento') {
      assert.equal(env.state.files.length, 1);
      assert.equal(env.state.files[0].trashed, false);
      assert.ok(env.state.rows[0].includes(env.state.files[0].getUrl()));
    }
  });
}

test('failure before the append attempt still cleans up only the newly created CV', () => {
  const env = setup({ fileUrlFails: true });
  assert.equal(env.post(fixtures.talento), 'error');
  assert.equal(env.state.rows.length, 0);
  assert.equal(env.state.files.length, 1);
  assert.equal(env.state.files[0].trashed, true);
  assert.equal(env.state.emails.length, 0);
  assert.deepEqual(env.state.events, ['lock', 'file', 'trash', 'release']);
  assert.deepEqual(env.state.logs, ['submission_write_failed']);
});

test('cleanup failure returns error, releases lock and logs no raw exception', () => {
  const env = setup({ fileUrlFails: true, cleanupFails: true });
  assert.equal(env.post(fixtures.talento), 'error');
  assert.equal(env.state.held, false);
  assert.deepEqual(env.state.logs, ['submission_file_cleanup_failed', 'submission_write_failed']);
});

test('Drive failure does not append a row and releases the lock', () => {
  const env = assertRejected(fixtures.talento, 'error', { fileFails: true });
  assert.equal(env.state.held, false);
});

test('reuses the configured folder and fails closed on inaccessible configured folder', () => {
  const env = setup();
  assert.equal(env.post(fixtures.talento), 'ok');
  assert.equal(env.post(fixtures.talento), 'ok');
  assert.equal(env.state.folders.length, 1);
  const broken = assertRejected(fixtures.talento, 'error', { properties: { CV_FOLDER_ID: 'synthetic-existing-folder' }, folderFails: true });
  assert.equal(broken.state.folders.length, 0);
});

for (const tipo of Object.keys(fixtures)) {
  test(`creates and validates a genuinely missing ${tipo} sheet under the lock`, () => {
    const env = setup({ missingSheet: true });
    assert.equal(env.post(fixtures[tipo]), 'ok');
    assert.equal(env.state.sheetsCreated, 1);
    assert.equal(env.state.rows.length, 2);
    assert.deepEqual(env.state.rows[0], ['data', ...env.sandbox.COLUMNS[tipo]]);
    assert.equal(env.state.headerReads, 1);
    assert.equal(env.state.held, false);
  });

  for (const [drift, header] of [
    ['reordered', values => {
      const name = values.indexOf('nome');
      const email = values.indexOf('email');
      [values[name], values[email]] = [values[email], values[name]];
      return values;
    }],
    ['inserted', values => { values.splice(1, 0, 'observacao_interna'); return values; }],
    ['missing', values => values.slice(0, -1)],
    ['renamed', values => values.map(value => value === 'email' ? 'E-mail' : value)],
    ['duplicate', values => values.map(value => value === 'email' ? 'nome' : value)],
    ['blank cell', values => values.map(value => value === 'email' ? '' : value)],
    ['whitespace', values => values.map(value => value === 'email' ? ' email ' : value)]
  ]) {
    test(`rejects ${drift} ${tipo} headers before folder, file, row or email effects`, () => {
      const env = assertRejected(fixtures[tipo], 'error', { header });
      const headerBefore = header(['data', ...env.sandbox.COLUMNS[tipo]]);
      assert.deepEqual(env.state.header, headerBefore, 'existing headers must not be migrated');
      assert.equal(env.state.sheetsCreated, 0);
      assert.equal(env.state.folders.length, 0);
      assert.deepEqual(env.state.events, ['lock', 'release']);
      assert.deepEqual(env.state.logs, ['submission_write_failed']);
      assert.equal(env.state.held, false);
    });
  }
}

test('rejects an existing empty sheet without silently initializing it', () => {
  const env = assertRejected(fixtures.talento, 'error', { header: () => [], lastRow: 0 });
  assert.deepEqual(env.state.header, []);
  assert.equal(env.state.sheetsCreated, 0);
  assert.equal(env.state.folders.length, 0);
  assert.deepEqual(env.state.events, ['lock', 'release']);
});

test('rejects content beyond the schema width even if the header prefix is correct', () => {
  const env = setup();
  const width = env.sandbox.COLUMNS.talento.length + 1;
  const rejected = assertRejected(fixtures.talento, 'error', { lastColumn: width + 1 });
  assert.equal(rejected.state.headerReads, 0);
  assert.equal(rejected.state.folders.length, 0);
  assert.deepEqual(rejected.state.events, ['lock', 'release']);
});

test('header read failure has no submission effects and logs no raw upstream exception', () => {
  const env = assertRejected(fixtures.talento, 'error', { headerReadFails: true });
  assert.equal(env.state.headerReads, 1);
  assert.equal(env.state.folders.length, 0);
  assert.deepEqual(env.state.events, ['lock', 'release']);
  assert.deepEqual(env.state.logs, ['submission_write_failed']);
});

test('a newly initialized sheet is verified before creating a CV or registration', () => {
  const env = setup({ missingSheet: true, headerReadFails: true });
  assert.equal(env.post(fixtures.talento), 'error');
  assert.equal(env.state.sheetsCreated, 1);
  assert.equal(env.state.rows.length, 1, 'only the new header may have been written');
  assert.deepEqual(env.state.rows[0], ['data', ...env.sandbox.COLUMNS.talento]);
  assert.equal(env.state.folders.length, 0);
  assert.equal(env.state.files.length, 0);
  assert.equal(env.state.emails.length, 0);
  assert.deepEqual(env.state.events, ['lock', 'row', 'release']);
});

test('notification failure preserves confirmed persistence and avoids logging personal data', () => {
  const env = setup({ mailFails: true });
  assert.equal(env.post(fixtures.pessoa), 'ok');
  assert.equal(env.state.rows.length, 1);
  assert.deepEqual(env.state.logs, ['submission_notification_failed']);
});

test('release failure does not hide a successfully stored registration', () => {
  const env = setup({ releaseFails: true });
  assert.equal(env.post(fixtures.pessoa), 'ok');
  assert.equal(env.state.rows.length, 1);
});

test('keeps spreadsheet formula protection after normalization', () => {
  const env = setup();
  assert.equal(env.post({ ...fixtures.pessoa, nome: '  =1+1', mensagem: '@unsafe' }), 'ok');
  assert.ok(env.state.rows[0].includes("'=1+1"));
  assert.ok(env.state.rows[0].includes("'@unsafe"));
});

test('bounded notifications omit the file body and strip subject newlines', () => {
  const env = setup();
  assert.equal(env.post({ ...fixtures.talento, nome: 'Pessoa\nTeste' }), 'ok');
  assert.equal(env.state.emails[0].subject.includes('\n'), false);
  assert.equal(env.state.emails[0].body.includes(fixtures.talento.curriculo_b64), false);
  assert.ok(env.state.emails[0].body.includes('https://drive.example.test/file/synthetic'));
});
