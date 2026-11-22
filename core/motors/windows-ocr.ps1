param([string]$ImagePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$engineType = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$languageType = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
if (!$ImagePath) {
  if (!$engineType::IsLanguageSupported($languageType::new('pt-BR'))) { exit 1 }
  exit 0
}
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await-Result($op, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  return $task.GetAwaiter().GetResult()
}
$fileType = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
$decoderType = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$bitmapType = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$resultType = [Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
$file = Await-Result ($fileType::GetFileFromPathAsync($ImagePath)) $fileType
$stream = Await-Result ($file.OpenReadAsync()) $streamType
try {
  $decoder = Await-Result ($decoderType::CreateAsync($stream)) $decoderType
  $limit = $engineType::MaxImageDimension
  if ($decoder.PixelWidth -gt $limit -or $decoder.PixelHeight -gt $limit) { throw 'Imagem muito grande' }
  $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) $bitmapType
  try {
    $engine = $engineType::TryCreateFromLanguage($languageType::new('pt-BR'))
    if (!$engine) { throw 'Idioma OCR indisponível' }
    $result = Await-Result ($engine.RecognizeAsync($bitmap)) $resultType
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
  } finally { $bitmap.Dispose() }
} finally { $stream.Dispose() }
