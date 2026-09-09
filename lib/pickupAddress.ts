export function splitHouseNumber(full: string): { street: string; house: string } {
  const raw = String(full || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { street: '', house: '' };
  const tagged = raw.match(/,?\s*(?:no\.?|nomor|number|#)\s*([a-z0-9][a-z0-9\-\/]{0,12})\b/i);
  if (tagged && tagged.index != null) {
    const house = String(tagged[1] || '').trim();
    const street = `${raw.slice(0, tagged.index)} ${raw.slice(tagged.index + tagged[0].length)}`
      .replace(/[,\s]+/g, ' ')
      .replace(/\s+,/g, ',')
      .trim()
      .replace(/^[,\s]+|[,\s]+$/g, '');
    return { street, house };
  }
  const head = raw.split(',')[0].trim();
  const bare = head.match(/^(.*\S)\s+(\d+[a-z]?(?:[\-\/]\d+[a-z]?)?)$/i);
  if (bare) {
    const rest = raw.slice(head.length).replace(/^[,\s]+/, '');
    return {
      street: rest ? `${bare[1].trim()}, ${rest}` : bare[1].trim(),
      house: String(bare[2] || '').trim()
    };
  }
  return { street: raw, house: '' };
}

export function isValidHouseNumber(value: string) {
  const v = String(value || '').replace(/\s+/g, ' ').trim();
  if (v.length < 1 || v.length > 80) return false;
  return /\d/.test(v) || /^[a-z][a-z0-9\-\/]{0,12}$/i.test(v);
}

export function composePickupAddress(street: string, house: string, landmark?: string) {
  const jalan = String(street || '').replace(/\s+/g, ' ').trim();
  const no = String(house || '').replace(/\s+/g, ' ').trim();
  const streetHasNo = /(?:no\.?|nomor|#)\s*[a-z0-9]/i.test(jalan);
  const houseHasNo = /(?:no\.?|nomor|#)/i.test(no);
  const withNo = no
    ? streetHasNo
      ? jalan
      : houseHasNo
        ? `${jalan}, ${no}`
        : `${jalan}, No. ${no}`
    : jalan;
  const note = String(landmark || '').trim();
  return note ? `${withNo} (Patokan: ${note})` : withNo;
}
