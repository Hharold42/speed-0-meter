/** Запрос отклонён защитным фильтром адресов (SSRF). Повторять бессмысленно. */
export class GuardError extends Error {
  override name = 'GuardError';
}
