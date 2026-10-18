const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const frontendSource = fs.readFileSync(path.join(__dirname, '../SCRIPT/form-validation.js'), 'utf8');
const backendSource = fs.readFileSync(path.join(__dirname, '../SCRIPT/formulario-apoie.gs'), 'utf8');
const server = vm.createContext({});
vm.runInContext(backendSource, server);

const common = { nome: 'Pessoa de Teste', email: 'pessoa@example.test', consentimento: 'sim', site: '' };
const samples = {
  empresa: { ...common, tipo: 'empresa', empresa: 'Empresa de Teste' },
  pessoa: { ...common, tipo: 'pessoa', perfil: 'Universitário(a)', estado: 'BA' },
  talento: {
    ...common, tipo: 'talento', celular: '71999999999', idade: '21', linkedin: '',
    genero: 'Prefiro não informar', raca: 'Prefiro não informar', estado: 'BA', cidade: 'Salvador',
    instituicao: 'Instituição de Teste', curso: 'Computação', semestre: '1º', formatura: '2028', areas: 'Tecnologia'
  }
};

function serverAccepts(data) {
  const parameters = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, [value]]));
  return Boolean(server.validate_(parameters, data.tipo));
}

function control(name, value, overrides = {}) {
  let customMessage = '';
  const field = {
    name, value, tagName: 'INPUT', type: 'text', required: false, checked: false,
    setCustomValidity(message) { customMessage = message; },
    get validationMessage() { return customMessage; },
    get validity() { return { customError: Boolean(customMessage) }; },
    ...overrides
  };
  return field;
}

function setup(tipo, changes = {}) {
  const window = {};
  vm.runInNewContext(frontendSource, { window });
  const data = { ...samples[tipo], ...changes };
  const selects = ['perfil', 'estado', 'genero', 'raca', 'semestre', 'formatura'];
  const fields = Object.fromEntries(Object.entries(data).map(([name, value]) => {
    const type = { tipo: 'hidden', email: 'email', idade: 'number', linkedin: 'url',
      celular: 'tel', consentimento: 'checkbox', areas: 'checkbox' }[name] || 'text';
    return [name, control(name, value, {
      type,
      tagName: selects.includes(name) ? 'SELECT' : 'INPUT',
      required: Array.from(server.REQUIRED[tipo]).includes(name),
      checked: name === 'consentimento' || name === 'areas'
    })];
  }));
  const form = {
    querySelectorAll(selector) {
      assert.equal(selector, 'input, textarea');
      return Object.values(fields).filter(field => field.tagName === 'INPUT' || field.tagName === 'TEXTAREA');
    }
  };
  return { fields, form, data, validate: () => window.LbnValidation.validate(form) };
}

for (const [tipo, name, value, expectedMessage] of [
  ['talento', 'idade', '2e1', /dois dígitos/],
  ['talento', 'idade', '021', /dois dígitos/],
  ['talento', 'linkedin', 'ftp://example.invalid/profile', /https:\/\//],
  ['pessoa', 'email', 'person@intranet', /domínio completo/],
  ['pessoa', 'nome', '   ', /sem usar apenas espaços/]
]) {
  test(`stops the BE-01 mismatch ${tipo}:${name}=${JSON.stringify(value)} with a field message`, () => {
    const env = setup(tipo, { [name]: value });
    assert.equal(serverAccepts(env.data), false, 'fixture must still be rejected by the actual backend validator');
    assert.equal(env.validate(), false);
    assert.match(env.fields[name].validationMessage, expectedMessage);
    assert.equal(env.fields[name].value, value, 'must not silently normalize incompatible input');
  });
}

for (const tipo of Object.keys(samples)) {
  test(`allows the usual ${tipo} data accepted by the actual backend`, () => {
    const env = setup(tipo);
    assert.equal(serverAccepts(env.data), true);
    assert.equal(env.validate(), true);
    assert.ok(Object.values(env.fields).every(field => !field.validationMessage));
  });
}

test('rejects whitespace in all required text fields while preserving optional text', () => {
  for (const [tipo, names] of [
    ['empresa', ['empresa', 'nome']], ['talento', ['nome', 'celular', 'cidade', 'instituicao', 'curso']]
  ]) {
    for (const name of names) {
      const env = setup(tipo, { [name]: ' \t ' });
      assert.equal(serverAccepts(env.data), false);
      assert.equal(env.validate(), false, name);
      assert.match(env.fields[name].validationMessage, /sem usar apenas espaços/);
    }
  }
  const env = setup('pessoa', { instituicao: '   ', mensagem: '   ' });
  env.fields.mensagem.tagName = 'TEXTAREA';
  assert.equal(serverAccepts(env.data), true);
  assert.equal(env.validate(), true);
});

test('clears its messages after the user corrects the fields and can detect a later error', () => {
  const env = setup('talento', { nome: ' ', idade: '021', email: 'person@intranet', linkedin: 'ftp://example.test' });
  assert.equal(env.validate(), false);
  for (const name of ['nome', 'idade', 'email', 'linkedin']) env.fields[name].value = samples.talento[name];
  assert.equal(env.validate(), true);
  assert.ok(Object.values(env.fields).every(field => !field.validationMessage));
  env.fields.idade.value = '2e1';
  assert.equal(env.validate(), false);
  assert.match(env.fields.idade.validationMessage, /dois dígitos/);
});

test('does not clear or approve validity owned by the areas, curriculum or consent controls', () => {
  const env = setup('talento');
  env.fields.curriculo = control('curriculo', '', { type: 'file', required: true });
  const messages = { areas: 'Selecione uma área.', curriculo: 'Arquivo inválido.', consentimento: 'Autorize o uso dos dados.' };
  for (const [name, message] of Object.entries(messages)) env.fields[name].setCustomValidity(message);
  assert.equal(env.validate(), true, 'true refers only to shared rules; the caller must still check native form validity');
  for (const [name, message] of Object.entries(messages)) assert.equal(env.fields[name].validationMessage, message);
});

test('preserves values, selections, consent and file handles on invalid and valid validation', () => {
  const env = setup('talento', { nome: '  Pessoa de Teste  ', idade: '021' });
  const file = { name: 'curriculo-sintetico.pdf' };
  env.fields.curriculo = control('curriculo', 'C:\\fakepath\\curriculo-sintetico.pdf', { type: 'file', files: [file] });
  const snapshot = Object.values(env.fields).map(field => [field.name, field.value, field.checked]);
  assert.equal(env.validate(), false);
  assert.deepEqual(Object.values(env.fields).map(field => [field.name, field.value, field.checked]), snapshot);
  assert.equal(env.fields.curriculo.files[0], file);
  env.fields.idade.value = '21';
  assert.equal(env.validate(), true);
  assert.equal(env.fields.nome.value, '  Pessoa de Teste  ');
  assert.equal(env.fields.consentimento.checked, true);
});

test('only checks controls present in the supplied form', () => {
  const env = setup('pessoa');
  delete env.fields.nome;
  delete env.fields.email;
  assert.equal(env.validate(), true);
  env.fields.campo_adicional = control('campo_adicional', '', { required: true });
  assert.equal(env.validate(), false);
  assert.match(env.fields.campo_adicional.validationMessage, /Informe este campo/);
});

test('matches the backend age boundaries and literal representation without rewriting the value', () => {
  for (const idade of ['14', '21', '99', '', '13', '100', '1.5', '-1', '20x', '2e1', '021', '21 ', ' 21']) {
    const env = setup('talento', { idade });
    assert.equal(env.validate(), serverAccepts(env.data), idade);
    assert.equal(env.fields.idade.value, idade);
  }
});

test('matches the backend email policy including trimming semantics and the raw length limit', () => {
  for (const email of ['pessoa@example.test', '  pessoa@example.test  ', 'person@intranet', '',
    'missing-at', 'a@', 'a b@example.test', 'a@example.test\nx', 'a'.repeat(150) + '@example.test']) {
    const env = setup('pessoa', { email });
    assert.equal(env.validate(), serverAccepts(env.data), email);
    assert.equal(env.fields.email.value, email);
  }
});

test('matches the optional HTTP(S) URL policy without adding an unsupported LinkedIn-domain restriction', () => {
  for (const linkedin of ['', '   ', 'https://linkedin.com/in/teste', 'http://example.test/profile?a=1#info',
    '  HTTPS://example.test/profile  ', 'ftp://example.test/profile', 'javascript:alert(1)', 'https://',
    'https://example.test/a b', 'https://example.test/' + 'a'.repeat(200)]) {
    const env = setup('talento', { linkedin });
    assert.equal(env.validate(), serverAccepts(env.data), linkedin);
    assert.equal(env.fields.linkedin.value, linkedin);
  }
});

test('preserves a custom error installed by another validator even on a field it also manages', () => {
  const env = setup('pessoa', { nome: ' ' });
  assert.equal(env.validate(), false);
  env.fields.nome.setCustomValidity('Mensagem de outro controle.');
  env.fields.nome.value = 'Pessoa de Teste';
  assert.equal(env.validate(), true);
  assert.equal(env.fields.nome.validationMessage, 'Mensagem de outro controle.');
  env.fields.nome.value = ' ';
  assert.equal(env.validate(), false);
  assert.equal(env.fields.nome.validationMessage, 'Mensagem de outro controle.');
});
