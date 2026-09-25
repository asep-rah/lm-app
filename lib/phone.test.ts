import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidCustomerPhone, maskPhone, parsePhone, phoneKey, phoneLookupKeys, samePhone, storedPhone, waDigits } from './phone';

describe('phone: Indonesian numbers keep their existing forms', () => {
  it('every way of typing the same Indonesian number gives the same forms', () => {
    for (const raw of ['081234567890', '6281234567890', '+62 812-3456-7890', '81234567890', '0062 812 3456 7890', ' 0812 3456 7890 ']) {
      assert.equal(storedPhone(raw), '081234567890', raw);
      assert.equal(phoneKey(raw), '6281234567890', raw);
      assert.equal(waDigits(raw), '6281234567890', raw);
      assert.equal(isValidCustomerPhone(raw), true, raw);
    }
  });
  it('lookup keys cover 08…, 62…, +62…', () => {
    assert.deepEqual(phoneLookupKeys('081234567890').sort(), ['081234567890', '6281234567890', '+6281234567890'].sort());
  });
  it('Indonesian non-mobile / too short is not a valid customer number', () => {
    assert.equal(isValidCustomerPhone('0221234567'), false); // landline
    assert.equal(isValidCustomerPhone('0812'), false);
  });
});

describe('phone: foreign numbers', () => {
  const cases: Array<[string, string, string]> = [
    ['+65 9123 4567', '+6591234567', '6591234567'], // Singapore
    ['+60 12-345 6789', '+60123456789', '60123456789'], // Malaysia
    ['+81 90-1234-5678', '+819012345678', '819012345678'], // Japan (starts with 8)
    ['+86 138 0013 8000', '+8613800138000', '8613800138000'], // China (starts with 8)
    ['+1 (415) 555-2671', '+14155552671', '14155552671'], // USA
    ['+44 7911 123456', '+447911123456', '447911123456'], // UK
    ['00966 50 123 4567', '+966501234567', '966501234567'], // Saudi Arabia via 00
    ['+61 412 345 678', '+61412345678', '61412345678'] // Australia
  ];
  it('are stored with "+" and sent to WhatsApp as digits', () => {
    for (const [raw, stored, wa] of cases) {
      assert.equal(storedPhone(raw), stored, raw);
      assert.equal(phoneKey(raw), stored, raw);
      assert.equal(waDigits(raw), wa, raw);
      assert.equal(isValidCustomerPhone(raw), true, raw);
    }
  });
  it('re-parsing any form is stable (no drift into Indonesian)', () => {
    for (const [raw, stored] of cases) {
      assert.equal(storedPhone(storedPhone(raw)), stored, raw);
      assert.equal(phoneKey(phoneKey(raw)), stored, raw);
    }
    assert.equal(storedPhone(storedPhone('0812 3456 7890')), '081234567890');
  });
  it('WhatsApp JIDs are always international (Japan 81… is not Indonesian 8…)', () => {
    assert.equal(phoneKey('819012345678', { international: true }), '+819012345678');
    assert.equal(phoneKey('6281234567890', { international: true }), '6281234567890');
    // Without the hint the Indonesian 8… shorthand wins — the picker adds "+".
    assert.equal(phoneKey('819012345678'), '62819012345678');
  });
  it('digits typed with a country code but without "+" are accepted', () => {
    assert.equal(storedPhone('6591234567'), '+6591234567');
    assert.equal(storedPhone('447911123456'), '+447911123456');
  });
  it('lookup keys: +cc… and cc…, never an Indonesian 08… look-alike', () => {
    const keys = phoneLookupKeys('+819012345678');
    assert.deepEqual(keys.sort(), ['+819012345678', '819012345678'].sort());
    assert.ok(!keys.some((k) => k.startsWith('0')));
  });
  it('rejects garbage', () => {
    for (const raw of ['', '   ', 'abc', '+0123456', '+12345', '+1234567890123456', null, undefined]) {
      assert.equal(storedPhone(raw), '', String(raw));
      assert.equal(isValidCustomerPhone(raw), false, String(raw));
    }
  });
  it('samePhone and mask', () => {
    assert.equal(samePhone('+65 9123 4567', '6591234567'), true);
    assert.equal(samePhone('081234567890', '+6281234567890'), true);
    assert.equal(samePhone('+819012345678', '0819012345678'), false);
    assert.equal(maskPhone('081234567890'), '08•••7890');
    assert.equal(maskPhone('+6591234567'), '+65•••4567');
  });
  it('parsePhone flags Indonesia', () => {
    assert.equal(parsePhone('+62812345678')?.indonesia, true);
    assert.equal(parsePhone('+6591234567')?.indonesia, false);
  });
});

describe('country picker', async () => {
  const { DIAL_COUNTRIES, composePhone, flagOf } = await import('./countryDialCodes');
  it('has every country once, Indonesia first', () => {
    const isos = DIAL_COUNTRIES.map((c) => c.iso);
    assert.equal(new Set(isos).size, isos.length);
    assert.equal(isos[0], 'ID');
    assert.ok(DIAL_COUNTRIES.length > 200, String(DIAL_COUNTRIES.length));
    assert.ok(DIAL_COUNTRIES.every((c) => /^[1-9]\d{0,3}$/.test(c.dial)));
    assert.equal(flagOf('ID'), '🇮🇩');
  });
  it('composes numbers that lib/phone stores correctly', () => {
    const cases: Array<[string, string, string]> = [
      ['62', '0812 3456 7890', '081234567890'],
      ['62', '812 3456 7890', '081234567890'],
      ['65', '9123 4567', '+6591234567'],
      ['60', '012-345 6789', '+60123456789'],
      ['81', '090-1234-5678', '+819012345678'],
      ['39', '06 1234 5678', '+390612345678'],
      ['1', '(415) 555-2671', '+14155552671'],
      ['65', '+44 7911 123456', '+447911123456'],
      ['44', '447911123456', '+447911123456']
    ];
    for (const [dial, typed, stored] of cases) {
      assert.equal(storedPhone(composePhone(dial, typed)), stored, `${dial} ${typed}`);
    }
    assert.equal(composePhone('65', ''), '');
  });
});
