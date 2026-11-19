import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { GuardError } from '../core/errors.js';
import type { UrlGuard } from '../core/types.js';

/** IPv4 из «a.b.c.d» в четыре октета. */
function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255) ? octets : null;
}

/** IPv6 в 16 байт; поддерживает «::» и IPv4 в хвосте. */
function parseIPv6(input: string): number[] | null {
  const ip = (input.split('%')[0] ?? '').toLowerCase();
  const halves = ip.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const piece of part.split(':')) {
      if (piece.includes('.')) {
        const v4 = parseIPv4(piece);
        if (!v4) return null;
        groups.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        groups.push(parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return groups;
  };

  const head = toGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? toGroups(halves[1] ?? '') : [];
  if (!head || !tail) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => [g >> 8, g & 0xff]);
}

function isPrivateIPv4(o: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = o;
  return (
    a === 0 || // «эта» сеть
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, в т.ч. метаданные облака 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // тестовые сети
    a >= 224 // multicast и зарезервированные
  );
}

/** true, если адрес указывает на локальную, внутреннюю или служебную сеть. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const v4 = parseIPv4(ip);
    return v4 === null || isPrivateIPv4(v4);
  }
  const bytes = parseIPv6(ip);
  if (bytes === null) return true; // не смогли разобрать — считаем небезопасным

  // ::ffff:a.b.c.d и NAT64 64:ff9b::a.b.c.d — проверяем вложенный IPv4
  const first10Zero = bytes.slice(0, 10).every((b) => b === 0);
  if (first10Zero && bytes[10] === 0xff && bytes[11] === 0xff)
    return isPrivateIPv4(bytes.slice(12));
  const nat64 = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];
  if (nat64.every((b, i) => bytes[i] === b)) return isPrivateIPv4(bytes.slice(12));

  if (bytes.every((b) => b === 0)) return true; // ::
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true; // ::1
  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;
  if (first === 0xfe && (second & 0xc0) === 0x80) return true; // fe80::/10
  if ((first & 0xfe) === 0xfc) return true; // fc00::/7 (ULA)
  if (first === 0xff) return true; // multicast
  return false;
}

/**
 * Защита от SSRF: адрес должен разрешаться только в публичные IP.
 * Проверка идёт перед каждым обращением, включая редиректы.
 *
 * Ограничение: между проверкой и самим соединением возможна подмена DNS-ответа
 * (DNS rebinding). Полностью закрывает это сетевой фильтр исходящего трафика на уровне
 * контейнера или хоста; см. README.
 */
export function createGuard(): UrlGuard {
  return async (url: URL): Promise<void> => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new GuardError('поддерживаются только http:// и https://');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) {
      if (isPrivateAddress(host)) {
        throw new GuardError(`адрес ${host} относится к внутренней сети — запрещено`);
      }
      return;
    }

    let addresses: { address: string }[];
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new GuardError(`не удалось разрешить имя ${host}`);
    }
    const blocked = addresses.find((a) => isPrivateAddress(a.address));
    if (blocked) {
      throw new GuardError(`имя ${host} указывает на внутренний адрес — запрещено`);
    }
  };
}
