'use strict';

const { GoogleAuth } = require('google-auth-library');
const { desktopGoogleAuth } = require('./google-desktop-auth');

const METADATA_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
const READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function driveError(code, message) {
  return Object.assign(new Error(message), { code });
}

class GoogleDriveProvider {
  constructor({ auth, mediaAuth } = {}) {
    const local = desktopGoogleAuth();
    this.auth = auth ?? local ?? new GoogleAuth({ scopes: [METADATA_SCOPE] });
    this.mediaAuth = mediaAuth ?? auth ?? local ?? new GoogleAuth({ scopes: [READ_SCOPE] });
  }

  async readImage(fileId) {
    const meta = await this.readMetadata(fileId);
    if (meta.trashed || !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(meta.mimeType)) return null;
    const bytes = await this.readContent(fileId, 1048576);
    return bytes?.length ? 'data:' + meta.mimeType + ';base64,' + bytes.toString('base64') : null;
  }

  async readJson(fileId) {
    const meta = await this.readMetadata(fileId);
    if (meta.trashed || meta.mimeType !== 'application/json') return null;
    const bytes = await this.readContent(fileId, 4 * 1024 * 1024);
    try { return bytes ? JSON.parse(bytes.toString('utf8')) : null; }
    catch { throw driveError('GOOGLE_DRIVE_RESPONSE_INVALID', 'Arquivo JSON inválido no Drive.'); }
  }

  async listFiles({ parent, name } = {}) {
    if ((parent && !/^[\w-]{10,200}$/.test(parent)) || (name && !/^[\w]+$/.test(name)) || (!parent && !name)) {
      throw driveError('DRIVE_FILE_ID_INVALID', 'Informe uma pasta ou nome de repositório válido.');
    }
    let client;
    try { client = await this.auth.getClient(); }
    catch { throw driveError('GOOGLE_AUTH_FAILED', 'Configure a autenticação Google no backend.'); }
    const query = ['trashed = false'];
    if (parent) query.push(`'${parent}' in parents`);
    if (name) query.push(`name = '${name}'`, "mimeType = 'application/vnd.google-apps.folder'");
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', query.join(' and '));
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)');
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    const files = [];
    for (let page = 0; page < 10; page++) {
      let data;
      try { ({ data } = await client.request({ url: url.href, method: 'GET', timeout: 10000, retry: false })); }
      catch (error) { throw driveError('GOOGLE_DRIVE_UNAVAILABLE', 'Falha na listagem do repositório Drive.'); }
      files.push(...(data.files ?? []));
      if (!data.nextPageToken) return files;
      url.searchParams.set('pageToken', data.nextPageToken);
    }
    throw driveError('GOOGLE_DRIVE_RESPONSE_INVALID', 'Listagem do repositório excedeu o limite.');
  }

  async readContent(fileId, limit) {
    if (typeof fileId !== 'string' || !/^[\w-]+$/.test(fileId)) throw driveError('DRIVE_FILE_ID_INVALID', 'Informe um ID válido.');
    let client;
    try { client = await this.mediaAuth.getClient(); }
    catch { throw driveError('GOOGLE_AUTH_FAILED', 'Configure a autenticação Google no backend.'); }
    const chunks = [];
    let bytes = 0;
    try {
      const { data } = await client.request({
        url: 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        method: 'GET', timeout: 10000, retry: false, responseType: 'stream'
      });
      for await (const chunk of data) {
        bytes += chunk.length;
        if (bytes > limit) return null;
        chunks.push(chunk);
      }
    } catch (error) {
      const status = error.response?.status;
      if (Number.isInteger(status)) throw driveError('GOOGLE_DRIVE_HTTP_' + status, 'Google Drive respondeu HTTP ' + status + '.');
      throw driveError('GOOGLE_DRIVE_UNAVAILABLE', 'Falha na comunicação com Google Drive.');
    }
    return Buffer.concat(chunks);
  }

  async readMetadata(fileId) {
    if (typeof fileId !== 'string' || !/^[\w-]+$/.test(fileId)) {
      throw driveError('DRIVE_FILE_ID_INVALID', 'Informe um ID de arquivo válido do Google Drive.');
    }

    let client;
    try {
      client = await this.auth.getClient();
    } catch {
      throw driveError('GOOGLE_AUTH_FAILED', 'Configure a autenticação Google no backend.');
    }

    const url = new URL('https://www.googleapis.com/drive/v3/files/' + fileId);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('fields', 'id,mimeType,trashed,modifiedTime');

    let file;
    try {
      const response = await client.request({ url: url.href, method: 'GET', timeout: 10000, retry: false });
      file = response.data;
    } catch (error) {
      const status = error.response?.status;
      if (Number.isInteger(status)) {
        throw driveError('GOOGLE_DRIVE_HTTP_' + status, 'Google Drive respondeu HTTP ' + status + '.');
      }
      throw driveError('GOOGLE_DRIVE_UNAVAILABLE', 'Falha na comunicação com Google Drive.');
    }

    if (file?.id !== fileId || typeof file.mimeType !== 'string' || typeof file.trashed !== 'boolean') {
      throw driveError('GOOGLE_DRIVE_RESPONSE_INVALID', 'O Google Drive retornou metadados inválidos.');
    }
    return { id: file.id, mimeType: file.mimeType, trashed: file.trashed, modifiedTime: file.modifiedTime ?? null };
  }
}

module.exports = { GoogleDriveProvider };
