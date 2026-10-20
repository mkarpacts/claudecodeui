// CP852 (DOS Central European) bytes 0x80–0xFF; the lower half is ASCII.
// Browsers' TextDecoder does not support it (WHATWG lists only IBM866 among DOS code pages).
const CP852_HIGH =
  'ÇüéâäůćçłëŐőîŹÄĆ' + // 0x80
  'ÉĹĺôöĽľŚśÖÜŤťŁ×č' + // 0x90
  'áíóúĄąŽžĘę¬źČş«»' + // 0xA0
  '░▒▓│┤ÁÂĚŞ╣║╗╝Żż┐' + // 0xB0
  '└┴┬├─┼Ăă╚╔╩╦╠═╬¤' + // 0xC0
  'đĐĎËďŇÍÎě┘┌█▄ŢŮ▀' + // 0xD0
  'ÓßÔŃńňŠšŔÚŕŰýÝţ´' + // 0xE0
  '­˝˛ˇ˘§÷¸°¨˙űŘř■ '; // 0xF0

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const decodeCp852 = (bytes: Uint8Array): string => {
  let result = '';
  for (const byte of bytes) {
    result += byte < 0x80 ? String.fromCharCode(byte) : CP852_HIGH[byte - 0x80];
  }
  return result;
};

// JSZip calls this for names and comments that are not flagged as UTF-8. Many tools write
// UTF-8 without the flag, so try it first; Windows Explorer on a Czech system writes CP852.
// Must never throw: an exception here fails the whole archive.
export function decodeZipFileName(bytes: string[] | Uint8Array | Buffer): string {
  // Browsers always pass a Uint8Array; the array form only exists without typed-array support
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes, Number);
  try {
    return utf8Decoder.decode(data);
  } catch {
    return decodeCp852(data);
  }
}
