(function () {
  'use strict';
  var tabs = Array.from(document.querySelectorAll('[data-support-tab]'));
  function selectTab(tab) {
    tabs.forEach(function (button) {
      var selected = button === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
    });
  }
  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { selectTab(tab); });
    tab.addEventListener('keydown', function (event) {
      var target;
      if (event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
      if (event.key === 'ArrowLeft') target = tabs[(index + tabs.length - 1) % tabs.length];
      if (event.key === 'Home') target = tabs[0];
      if (event.key === 'End') target = tabs[tabs.length - 1];
      if (!target) return;
      event.preventDefault();
      selectTab(target);
      target.focus();
    });
  });
  document.querySelectorAll('.lbn-form').forEach(function (form) {
    window.LbnSite.bindForm(form, function (event) {
      event.preventDefault();
      if (form.dataset.submitting === 'true') return;
      var status = form.querySelector('.lbn-status');
      status.className = 'lbn-status';
      if (!form.checkValidity()) {
        status.classList.add('is-error');
        status.textContent = 'Confira os campos obrigatórios marcados com *.';
        var invalid = form.querySelector('input:invalid,select:invalid,textarea:invalid');
        if (invalid) invalid.focus();
        return;
      }
      var data = new FormData(form);
      if (data.get('site')) return;
      window.LbnSite.submit(form, data, null, 'Recebemos o seu contato. Obrigado! Respondemos em breve.');
    });
  });

  // Preserva a animação original, sem ocultar conteúdo para movimento reduzido.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  var targets = [];
  document.querySelectorAll('.lbn-sec > div > *').forEach(function (element) {
    if (getComputedStyle(element).position === 'absolute') return;
    var items = element.querySelectorAll(':scope > .lbn-card, :scope > .lbn-offer');
    if (items.length) {
      Array.from(element.children).forEach(function (child, index) {
        child.style.transitionDelay = (index * 90) + 'ms';
        targets.push(child);
      });
    } else targets.push(element);
  });
  document.documentElement.classList.add('lbn-js');
  targets.forEach(function (element) { element.classList.add('lbn-reveal'); });
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
      setTimeout(function () { entry.target.style.transitionDelay = ''; }, 1200);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  targets.forEach(function (element) { observer.observe(element); });
})();
