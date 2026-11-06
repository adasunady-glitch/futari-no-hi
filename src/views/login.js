import { h } from '../lib/dom.js';

export function renderLogin(store, onSuccess) {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, id: 'login-email' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true, id: 'login-password' });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const button = h('button', { class: 'btn btn-primary btn-wide', type: 'submit' }, 'ひらく');

  const form = h('form', {
    class: 'login-form',
    onsubmit: async (event) => {
      event.preventDefault();
      button.disabled = true;
      error.textContent = '';
      try {
        await store.signIn(email.value.trim(), password.value);
        await onSuccess();
      } catch (failure) {
        console.warn(failure);
        error.textContent = 'メールアドレスかパスワードが違うようです';
        button.disabled = false;
      }
    },
  },
  h('label', { for: 'login-email' }, 'メールアドレス'), email,
  h('label', { for: 'login-password' }, 'パスワード'), password,
  error,
  button);

  return h('div', { class: 'login' },
    h('h1', { class: 'brand brand-large' }, 'ふたりの日'),
    h('p', { class: 'muted' }, '会った日のことを、ふたりで残す日記'),
    form);
}
