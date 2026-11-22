'use strict';

const { GoogleAuth } = require('google-auth-library');
const { desktopGoogleAuth } = require('./google-desktop-auth');

const METADATA_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';

function driveError(code, message) {
  return Object.assign(new Error(message), { code });
}

class GoogleDriveProvider {
  constructor({ auth = desktopGoogleAuth() ?? new GoogleAuth({ scopes: [METADATA_SCOPE] }) } = {}) {
    this.auth = auth;
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
