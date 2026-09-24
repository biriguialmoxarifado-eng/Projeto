/**
 * ============================================================
 * 16 - BACKUP
 * ============================================================
 * Infraestrutura central para snapshot da planilha em Google Drive.
 * Nunca exclui backups automaticamente nesta fase. Aba BACKUP registra
 * histórico: id | data | origem | destino | status
 */

var AP_Backup = {
  snapshot: function (motivo) { return AP_Backup_snapshot_(motivo); },
  list: function () { return AP_Data_rows(AP_SHEETS.BACKUP); }
};

function AP_Backup_snapshot_(motivo) {
  AP_Data_getSheet(AP_SHEETS.BACKUP, ['id', 'data', 'origem', 'destino', 'status', 'motivo']);
  var id = AP_Utils_generateId('BKP');
  var record = { id: id, data: AP_Utils_now(), origem: '', destino: '', status: 'PENDING', motivo: motivo || '' };

  try {
    var ss = AP_Config_getSpreadsheet_();
    var srcFile = DriveApp.getFileById(ss.getId());
    record.origem = ss.getId();

    var folderName = 'AlmoxaPro_Backups';
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

    var copyName = 'BACKUP_' + AP_Utils_formatDate(new Date(), 'yyyyMMdd_HHmmss') + '_' + ss.getName();
    var copy = srcFile.makeCopy(copyName, folder);

    record.destino = copy.getId();
    record.status = 'SUCCESS';
  } catch (e) {
    record.status = 'ERROR';
    record.motivo = (record.motivo ? record.motivo + ' | ' : '') + 'erro: ' + e.message;
    AP_ErrorHandler_capture('AP_Backup_snapshot_', e);
  }

  AP_Data_append(AP_SHEETS.BACKUP, record);
  AP_EventBus.emit('CORE.BACKUP_EXECUTADO', { id: id, status: record.status });
  return record.status === 'SUCCESS'
    ? AP_Utils_ok(record, 'Backup concluído com sucesso.')
    : AP_Utils_fail('ERRO_BACKUP', 'Falha ao gerar backup.', record);
}

