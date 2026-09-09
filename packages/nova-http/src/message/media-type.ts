/** 提取不含参数的媒体类型并统一为小写 */
export function mediaType(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

export function isJsonMediaType(value: string): boolean {
  const type = mediaType(value);
  return type === "application/json" || /^application\/[!#$%&'*+.^_`|~0-9a-z-]+\+json$/.test(type);
}
