import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isImageFileLike,
  safeSatuanPhotoPrefix,
  satuanItemHasRequiredPhotos,
  SATUAN_ITEM_PHOTO_BUCKET,
  SATUAN_ITEM_PHOTO_SIGNED_URL_TTL_SEC
} from './satuanItemPhoto';

describe('isImageFileLike — guard before attempting an upload', () => {
  it('accepts common image mime types', () => {
    assert.ok(isImageFileLike({ type: 'image/jpeg' }));
    assert.ok(isImageFileLike({ type: 'image/png' }));
    assert.ok(isImageFileLike({ type: 'image/webp' }));
  });

  it('rejects non-image files and missing/empty type', () => {
    assert.equal(isImageFileLike({ type: 'application/pdf' }), false);
    assert.equal(isImageFileLike({ type: '' }), false);
    assert.equal(isImageFileLike({}), false);
    assert.equal(isImageFileLike(null), false);
    assert.equal(isImageFileLike(undefined), false);
  });
});

describe('safeSatuanPhotoPrefix — storage path safety', () => {
  it('strips unsafe characters, keeping only alphanumerics/underscore/dash', () => {
    assert.equal(safeSatuanPhotoPrefix('satuan_+62 812/../../etc'), 'satuan_62812etc');
    assert.match(safeSatuanPhotoPrefix('satuan_+62 812/../../etc'), /^[a-zA-Z0-9_-]+$/);
  });

  it('truncates very long prefixes to 60 chars', () => {
    assert.equal(safeSatuanPhotoPrefix('a'.repeat(200)).length, 60);
  });

  it('falls back to "item" for an empty/entirely-unsafe prefix', () => {
    assert.equal(safeSatuanPhotoPrefix(''), 'item');
    assert.equal(safeSatuanPhotoPrefix('///'), 'item');
  });
});

describe('satuanItemHasRequiredPhotos — every piece on the line must have a photo', () => {
  it('rejects a line with no pieces at all', () => {
    assert.equal(satuanItemHasRequiredPhotos({ pieces: [] }), false);
    assert.equal(satuanItemHasRequiredPhotos({}), false);
  });

  it('rejects when any single piece (out of several) is missing its photo', () => {
    assert.equal(
      satuanItemHasRequiredPhotos({
        pieces: [{ photo_path: 'a.jpg' }, { photo_path: '' }, { photo_path: 'c.jpg' }]
      }),
      false
    );
  });

  it('accepts only when every piece has a non-empty photo_path', () => {
    assert.equal(
      satuanItemHasRequiredPhotos({ pieces: [{ photo_path: 'a.jpg' }, { photo_path: 'b.jpg' }] }),
      true
    );
  });
});

describe('bucket is private, not a public-URL bucket', () => {
  it('exposes the bucket name and a sane signed-URL TTL', () => {
    assert.equal(SATUAN_ITEM_PHOTO_BUCKET, 'satuan-item-photos');
    assert.ok(SATUAN_ITEM_PHOTO_SIGNED_URL_TTL_SEC > 0 && SATUAN_ITEM_PHOTO_SIGNED_URL_TTL_SEC <= 24 * 3600);
  });
});
