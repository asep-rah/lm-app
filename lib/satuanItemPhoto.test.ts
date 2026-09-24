import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isImageFileLike,
  satuanItemHasRequiredPhotos,
  SATUAN_ITEM_PHOTO_BUCKET
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

describe('bucket name', () => {
  it('matches the private bucket created by the migration', () => {
    assert.equal(SATUAN_ITEM_PHOTO_BUCKET, 'satuan-item-photos');
  });
});
