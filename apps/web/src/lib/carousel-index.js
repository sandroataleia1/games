// Wraps an arbitrary (possibly negative, possibly out-of-range) index into
// [0, count). Pulled out of the carousel component so the circular-progress
// and single-slide behaviors have a plain, DOM-free unit test.
export function wrapIndex(index, count) {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}
