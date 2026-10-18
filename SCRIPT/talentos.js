(function () {
  'use strict';
  var form = document.getElementById('form-talento');
  var status = form.querySelector('.lbn-status');
  var fileInput = form.querySelector('[name="curriculo"]');
  var firstArea = form.querySelector('[name="areas"]');
  var TYPES = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  function fail(message, element) {
    status.textContent = message;
    status.className = 'lbn-status is-error';
    if (element) element.focus();
  }
  function checkAreas() {
    var valid = !!form.querySelector('[name="areas"]:checked');
    firstArea.setCustomValidity(valid ? '' : 'Marque pelo menos uma área.');
  }
  function fileType(file) {
    var extension = (file.name.split('.').pop() || '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(TYPES, extension) ? TYPES[extension] : '';
  }
  function checkFile() {
    var file = fileInput.files[0];
    var message = '';
    if (file && !fileType(file)) message = 'O currículo precisa ser PDF ou Word (.pdf, .doc, .docx).';
    else if (file && file.size === 0) message = 'O currículo está vazio. Escolha outro arquivo.';
    else if (file && file.size > 5 * 1024 * 1024) message = 'O currículo passa de 5 MB. Tente exportar um PDF mais leve.';
    fileInput.setCustomValidity(message);
    return message;
  }
  form.addEventListener('change', function (event) {
    if (event.target.name === 'areas') checkAreas();
    if (event.target === fileInput) {
      var message = checkFile();
      if (message) fail(message);
      else if (status.classList.contains('is-error')) status.textContent = '';
    }
  });
  form.addEventListener('reset', function () {
    firstArea.setCustomValidity('');
    fileInput.setCustomValidity('');
  });
  function readBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
      reader.onerror = reader.onabort = function () { reject(new Error('file-read-failed')); };
      reader.readAsDataURL(file);
    });
  }
  window.LbnSite.bindForm(form, function (event) {
    event.preventDefault();
    if (form.dataset.submitting === 'true') return;
    checkAreas();
    var fileMessage = checkFile();
    if (!form.checkValidity()) {
      var invalid = form.querySelector('input:invalid,select:invalid,textarea:invalid');
      if (invalid === fileInput && fileMessage) return fail(fileMessage, invalid);
      if (invalid === firstArea) return fail('Marque pelo menos uma área de interesse.', invalid);
      return fail('Confira os campos obrigatórios marcados com *.', invalid);
    }
    var data = new FormData(form);
    if (data.get('site')) return;
    var file = fileInput.files[0];
    data.delete('curriculo');
    window.LbnSite.submit(form, data, function (payload) {
      return readBase64(file).then(function (base64) {
        payload.append('curriculo_b64', base64);
        payload.append('curriculo_tipo', fileType(file));
        return payload;
      });
    }, 'Cadastro recebido! Seu perfil já faz parte do Banco de Talentos do Encontro. Nos vemos em Salvador.');
  });
})();
