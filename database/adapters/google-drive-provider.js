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
    if (meta.trashed || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(meta.mimeType)) return null;
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
        if (bytes > 1048576) return null;
        chunks.push(chunk);
      }
    } catch (error) {
      const status = error.response?.status;
      if (Number.isInteger(status)) throw driveError('GOOGLE_DRIVE_HTTP_' + status, 'Google Drive respondeu HTTP ' + status + '.');
      throw driveError('GOOGLE_DRIVE_UNAVAILABLE', 'Falha na comunicação com Google Drive.');
    }
    return 'data:' + meta.mimeType + ';base64,' + Buffer.concat(chunks).toString('base64');
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
