'use strict';

const form = document.querySelector('#diagnostics');
const result = document.querySelector('#result');

form.addEventListener('submit', async event => {
  event.preventDefault();
  const action = event.submitter.value;
  const fields = new FormData(form);
  const id = fields.get('id').trim();
  if (action !== 'list' && !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    result.textContent = 'Informe o ID do registro.';
    return;
  }
  let path = '/api/v2/diagnostics';
  if (action === 'read' || action === 'update') path += '/' + encodeURIComponent(id);
  const method = { create: 'POST', update: 'PATCH' }[action] || 'GET';
  const options = {
    method,
    headers: { Authorization: 'Bearer ' + fields.get('token') },
    signal: AbortSignal.timeout(10000)
  };
  if (method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(action === 'create'
      ? { id, origin: fields.get('origin'), message: fields.get('message') }
      : { message: fields.get('message'), version: Number(fields.get('version')) });
  }
  try {
    const response = await fetch(path, options);
    const body = await response.json();
    result.textContent = JSON.stringify(body, null, 2);
    if (body.ok && body.data?.id) {
      form.elements.version.value = body.data.version;
      form.elements.message.value = body.data.message;
    }
  } catch {
    result.textContent = 'Falha de comunicação. Consulte o registro antes de repetir a atualização.';
  }
});
