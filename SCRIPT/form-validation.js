(function () {
  'use strict';

  var ownMessages = new WeakMap();
  var labels = {
    empresa: 'o nome da empresa', nome: 'seu nome', email: 'seu e-mail',
    celular: 'seu celular', cidade: 'sua cidade', instituicao: 'sua instituição de ensino',
    curso: 'seu curso'
  };

  function messageFor(field) {
    var type = (field.type || '').toLowerCase();
    var isText = field.tagName === 'TEXTAREA' ||
      ['text', 'email', 'tel', 'url', 'search', 'password'].indexOf(type) !== -1;
    // Arquivo, seleções, consentimento e grupos de opções têm seus próprios
    // controles. A validação nativa continua necessária depois desta função.
    if (!isText && field.name !== 'idade') return '';
    var value = field.value;
    var trimmed = value.trim();
    if (field.required && !trimmed) {
      return 'Informe ' + (labels[field.name] || 'este campo') + ', sem usar apenas espaços.';
    }
    if (field.name === 'email' && trimmed &&
        (value.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed))) {
      return 'Informe um e-mail com domínio completo, como nome@exemplo.com.';
    }
    if (field.name === 'idade' && (value || field.required) &&
        (!/^\d{2}$/.test(value) || Number(value) < 14 || Number(value) > 99)) {
      return 'Informe a idade de 14 a 99 usando exatamente dois dígitos, como 21.';
    }
    if (field.name === 'linkedin' &&
        (value.length > 200 || (trimmed && !/^https?:\/\/[^\s/]+(?:[/?#][^\s]*)?$/i.test(trimmed)))) {
      return 'Informe um endereço completo iniciado por https:// ou http://, ou deixe o LinkedIn vazio.';
    }
    return '';
  }

  function validate(form) {
    var valid = true;
    form.querySelectorAll('input, textarea').forEach(function (field) {
      // Apague somente uma mensagem criada por este módulo. Se outro controle
      // a substituiu, ele mantém a responsabilidade por removê-la.
      var previous = ownMessages.get(field);
      if (previous && field.validationMessage === previous) field.setCustomValidity('');
      ownMessages.delete(field);
      var message = messageFor(field);
      if (!message) return;
      valid = false;
      if (!field.validity.customError) {
        field.setCustomValidity(message);
        ownMessages.set(field, message);
      }
    });
    return valid;
  }

  window.LbnValidation = { validate: validate };
})();
