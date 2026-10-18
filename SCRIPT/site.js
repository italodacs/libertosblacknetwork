(function () {
  'use strict';

  var KEY = 'lbn-site-theme';
  var root = document.getElementById('lbn-root');
  var EMAIL = 'libertosblacknetwork@gmail.com';
  // Endpoint público, não é uma credencial. Atualize aqui para as duas páginas.
  var FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwR0TIvqx3XPloLgPd8pa8uFwXVHzonjw02roO92YIEu397mCWQcnEGztMf0Hr-P2KKTQ/exec';
  var TIMEOUT_MS = 25000;

  function applyTheme(theme) {
    root.setAttribute('data-lbn-theme', theme);
    document.documentElement.style.background = theme === 'dark' ? '#0A0A0A' : '#FFFFFF';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-label', theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
    });
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      var theme = root.getAttribute('data-lbn-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      try { localStorage.setItem(KEY, theme); } catch (error) { /* Preferência opcional. */ }
    });
  });
  var saved;
  try { saved = localStorage.getItem(KEY); } catch (error) { /* Navegação sem storage. */ }
  applyTheme(saved === 'dark' ? 'dark' : 'light');

  function send(data) {
    var controller = new AbortController();
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        controller.abort();
        reject(new Error('submission-timeout'));
      }, TIMEOUT_MS);
    });
    // O Apps Script atual não oferece confirmação legível em no-cors.
    // Opaque significa resultado desconhecido; nunca significa cadastro recebido.
    var request = Promise.resolve().then(function () {
      return fetch(FORM_ENDPOINT, {
        method: 'POST', mode: 'no-cors', body: new URLSearchParams(data), signal: controller.signal
      });
    }).then(function (response) {
      if (response.type === 'opaque' || response.type === 'opaqueredirect') return false;
      if (!response.ok) throw new Error('submission-http-error');
      return response.text().then(function (body) {
        if (body.trim() !== 'ok') throw new Error('submission-rejected');
        return true;
      });
    });
    return Promise.race([request, timeout]).finally(function () { clearTimeout(timer); });
  }

  function submit(form, data, prepare, successMessage) {
    if (form.dataset.submitting === 'true') return Promise.resolve();
    var status = form.querySelector('.lbn-status');
    var button = form.querySelector('.lbn-submit');
    form.dataset.submitting = 'true';
    form.setAttribute('aria-busy', 'true');
    button.disabled = true;
    status.className = 'lbn-status';
    status.textContent = 'Enviando...';
    return Promise.resolve().then(function () {
      return prepare ? prepare(data) : data;
    }).then(send).then(function (confirmed) {
      if (confirmed) {
        form.reset();
        status.className = 'lbn-status is-ok';
        status.textContent = successMessage;
      } else {
        status.className = 'lbn-status is-pending';
        status.textContent = 'O envio foi tentado, mas não conseguimos confirmar o recebimento. Seus campos foram mantidos. Antes de enviar novamente, confirme com ' + EMAIL + '.';
      }
    }).catch(function () {
      status.className = 'lbn-status is-error';
      status.textContent = 'Não conseguimos confirmar o envio agora. Seus campos foram mantidos. Antes de reenviar, entre em contato pelo e-mail ' + EMAIL + '.';
    }).finally(function () {
      form.dataset.submitting = 'false';
      form.removeAttribute('aria-busy');
      button.disabled = false;
    });
  }

  // O HTML começa fechado. Somente este formulário é habilitado depois de
  // registrar seu handler e confirmar que a validação compartilhada carregou.
  function bindForm(form, handler) {
    var controls = form.querySelector('[data-form-controls]');
    var unavailable = form.querySelector('[data-form-unavailable]');
    if (!controls || !unavailable || typeof handler !== 'function' ||
        !window.LbnValidation || typeof window.LbnValidation.validate !== 'function') {
      throw new Error('form-initialization-incomplete');
    }
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (controls.disabled) return;
      if (!window.LbnValidation.validate(form)) {
        var invalid = form.querySelector('input:invalid,select:invalid,textarea:invalid');
        var status = form.querySelector('.lbn-status');
        status.className = 'lbn-status is-error';
        status.textContent = invalid ? invalid.validationMessage : 'Confira os campos informados.';
        if (invalid) invalid.focus();
        return;
      }
      handler(event);
    });
    controls.disabled = false;
    unavailable.hidden = true;
  }

  window.LbnSite = { send: send, submit: submit, bindForm: bindForm, email: EMAIL };
})();
