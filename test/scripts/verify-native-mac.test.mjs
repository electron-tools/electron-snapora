// Structural release checks run on all platforms; they do not claim to validate a code signature.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyUniversalMacHelper } from '../../scripts/verify-native-mac.mjs';

function universal() {
  const data = Buffer.alloc(128);
  data.writeUInt32BE(0xcafebabe, 0);
  data.writeUInt32BE(2, 4);
  for (const [index, cpu] of [0x01000007, 0x0100000c].entries()) {
    const offset = 64 + index * 32;
    data.writeUInt32BE(cpu, 8 + index * 20);
    data.writeUInt32BE(offset, 16 + index * 20);
    data.writeUInt32BE(32, 20 + index * 20);
    data.writeUInt32LE(0xfeedfacf, offset);
    data.writeUInt32LE(cpu, offset + 4);
    data.writeUInt32LE(2, offset + 12);
  }
  return data;
}

test('accepts two valid executable slices', () =>
  assert.doesNotThrow(() => verifyUniversalMacHelper(universal())));
test('rejects missing, thin, truncated and duplicate architecture artifacts', () => {
  for (const data of [Buffer.alloc(0), Buffer.alloc(64), universal().subarray(0, 100)])
    assert.throws(() => verifyUniversalMacHelper(data));
  const duplicate = universal();
  duplicate.writeUInt32BE(0x01000007, 28);
  duplicate.writeUInt32LE(0x01000007, 100);
  assert.throws(() => verifyUniversalMacHelper(duplicate), /x86_64 and arm64/);
});
test('rejects overlapping or non-executable slices', () => {
  const overlap = universal();
  overlap.writeUInt32BE(64, 36);
  assert.throws(() => verifyUniversalMacHelper(overlap), /overlapping/);
  const library = universal();
  library.writeUInt32LE(6, 76);
  assert.throws(() => verifyUniversalMacHelper(library), /executable/);
});
