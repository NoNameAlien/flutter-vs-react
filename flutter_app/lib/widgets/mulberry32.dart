class Mulberry32 {
  int _t;
  Mulberry32(int seed) : _t = seed & 0xFFFFFFFF;
  double nextDouble() {
    _t = (_t + 0x6D2B79F5) & 0xFFFFFFFF;
    int r = (_t ^ (_t >> 15));
    r = (r * (1 | _t)) & 0xFFFFFFFF;
    r = (r + (((r ^ (r >> 7)) * (61 | r)) & 0xFFFFFFFF)) ^ r;
    return (((r ^ (r >> 14)) & 0xFFFFFFFF) >>> 0) / 4294967296.0;
  }
}
