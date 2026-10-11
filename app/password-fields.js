(() => {
  const eye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const hiddenEye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3.1 3.9M6.2 6.2A22 22 0 0 0 2 12s3.5 7 10 7a13 13 0 0 0 5.8-1.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  function sync(input, button) {
    const visible = input.type !== 'password';
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(visible));
    button.title = visible ? 'Hide password' : 'Show password';
    button.innerHTML = visible ? hiddenEye : eye;
  }
  function enhance() {
    document.querySelectorAll('input[type="password"]').forEach(input => {
      if (input.closest('.lexus-password-field')) return;
      const wrapper = document.createElement('span');wrapper.className = 'lexus-password-field';
      input.before(wrapper);wrapper.append(input);
      const button = document.createElement('button');button.type = 'button';button.className = 'lexus-password-toggle';
      wrapper.append(button);sync(input, button);
      button.addEventListener('click', () => {input.type = input.type === 'password' ? 'text' : 'password';sync(input, button);input.focus();});
      new MutationObserver(() => sync(input, button)).observe(input, {attributes:true,attributeFilter:['type']});
    });
  }
  function start() {enhance();new MutationObserver(enhance).observe(document.body, {childList:true,subtree:true});}
  if(document.readyState === 'loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
