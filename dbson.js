const TYPES = {
  NUMBER: 0x01
  , STRING: 0x02
  , OBJECT: 0x03
  , ARRAY: 0x04
  , BINARY: 0x05
  , UNDEFINED: 0x06
  , OBJECTID: 0x07
  , BOOLEAN: 0x08
  , DATE: 0x09
  , NULL: 0x0A
  , REGEXP: 0x0B
  , CODE: 0x0D
  , SYMBOL: 0x0E
  , CODE_W_SCOPE: 0x0F
  , INT32: 0x10
  , TIMESTAMP: 0x11
  , INT64: 0x12
  , DECIMAL128: 0x13
  , MIN_KEY: 0xFF
  , MAX_KEY: 0x7F
};

const BINARY = {
  GENERIC: 0x00
  , FUNCTION: 0x01
  , BINARY_OLD: 0x02
  , UUID_OLD: 0x03
  , UUID: 0x04
  , MD5: 0x05
  , ENCRYPTED: 0x06
  , COMPRESSED: 0x07
  , USER_DEFINED: 0x80
};

const BUF = {
  double: new Float64Array(new ArrayBuffer(8))
  , uint8: new Uint8Array(8)
  , int32: new Int32Array(new ArrayBuffer(4))
};

class BSONError extends Error {
  constructor(msg, code, details = {}) {
      super(msg);
      Object.assign(this, {
          name: 'BSONError'
          , code
          , details
      });
  }
}

class ObjectId {
  constructor(id) {
      this.id = id || (() => {
          const buf = new Uint8Array(12);
          const now = Math.floor(Date.now() / 1000);
    [now, Math.random() * 16777216, Math.random() * 65536, Math.random() * 16777216]
          .forEach((val, i) => {
              for (let j = 0; j < 4; j++) buf[i * 3 + j] = (val >> ((3 - j) * 8)) & 0xff;
          });
          return buf;
      })();
  }
  toString() {
      return Array.from(this.id).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  equals(other) {
      return other instanceof ObjectId && this.toString() === other.toString();
  }
  getTimestamp() {
      return new Date(((this.id[0] << 24) | (this.id[1] << 16) | (this.id[2] << 8) | this.id[3]) * 1000);
  }
}

const SimpleClasses = {
  BSONTimestamp: class {
      constructor(l, h) {
    [this.low, this.high] = [l >>> 0, h >>> 0];
      }
      equals(other) {
          return other instanceof SimpleClasses.BSONTimestamp &&
              this.low === other.low &&
              this.high === other.high;
      }
  }
  , BSONSymbol: class {
      constructor(v) {
          this.value = v;
      }
      equals(other) {
          return other instanceof SimpleClasses.BSONSymbol &&
              this.value === other.value;
      }
  }
  , BSONCode: class {
      constructor(c, s = null) {
    [this.code, this.scope] = [c, s];
      }
      equals(other) {
          return other instanceof SimpleClasses.BSONCode &&
              this.code === other.code &&
              ((!this.scope && !other.scope) ||
                  (this.scope && other.scope && this._deepEqual(this.scope, other.scope)));
      }
      _deepEqual(a, b) {
          if (a === b) return true;
          if (typeof a !== typeof b) return false;
          if (typeof a !== 'object') return false;
          if (!a || !b) return false;
          const keys = Object.keys(a);
          return keys.length === Object.keys(b).length &&
              keys.every(key => this._deepEqual(a[key], b[key]));
      }
  }
  , BSONDecimal128: class {
      constructor(b) {
          this.bytes = new Uint8Array(b || 16);
      }
      equals(other) {
          return other instanceof SimpleClasses.BSONDecimal128 &&
              this.bytes.every((byte, i) => byte === other.bytes[i]);
      }
      toString() {
          const view = new DataView(this.bytes.buffer);
          return `${view.getBigInt64(8, true)}${view.getBigInt64(0, true)}`;
      }
  }
};

class BSONSerializer {
  static serialize(data, opts = {}) {
      const state = {
          pos: 0
          , buffer: new Uint8Array(this._size(data))
          , seen: new WeakSet()
          , depth: {
              max: opts.maxDepth || 100
              , current: 0
          }
      };

      try {
          this._validate(data, '', state);
          this._write(data, state, opts);
          return state.buffer.slice(0, state.pos);
      } catch (e) {
          throw new BSONError(`Serialization failed: ${e.message}`, e.code || 'SERIALIZE_ERROR', {
              path: e.path
          });
      }
  }

  static _size(d) {
      if (!d || typeof d !== 'object') return 16;
      if (d instanceof ObjectId) return 12;
      if (d instanceof SimpleClasses.BSONTimestamp) return 8;
      if (d instanceof SimpleClasses.BSONDecimal128) return 16;
      if (d instanceof SimpleClasses.BSONSymbol) return d.value.length + 5;
      if (d instanceof SimpleClasses.BSONCode) return d.code.length + (d.scope ? this._size(d.scope) : 0) + 8;
      if (d instanceof RegExp) return d.source.length + d.flags.length + 14;
      return Object.keys(d).reduce((s, k) => s + k.length + 2 + this._size(d[k]), 128);
  }

  static _validate(d, p, s) {
      if (!d || typeof d !== 'object') return;

      if (s.seen.has(d)) {
          throw new BSONError('Circular reference detected', 'CIRCULAR_REFERENCE', {
              path: p
          });
      }

      s.seen.add(d);

      if (s.depth.current++ > s.depth.max) {
          s.depth.current--;
          throw new BSONError('Max depth exceeded', 'MAX_DEPTH_EXCEEDED', {
              path: p
          });
      }

      try {
          if (Array.isArray(d)) {
              d.forEach((v, i) => {
                  if (v && typeof v === 'object') {
                      this._validate(v, p ? `${p}[${i}]` : `[${i}]`, s);
                  }
              });
          } else {
              Object.entries(d).forEach(([k, v]) => {
                  const cp = p ? `${p}.${k}` : k;
                  if (k.includes('\0')) throw new BSONError('Null in key', 'INVALID_KEY', {
                      path: cp
                  });
                  if (k.includes('.')) throw new BSONError('Dot in key', 'INVALID_KEY', {
                      path: cp
                  });
                  if (k[0] === '$' && !this._isOp(k)) throw new BSONError('Invalid $ prefix', 'INVALID_KEY', {
                      path: cp
                  });
                  if (v && typeof v === 'object') {
                      this._validate(v, cp, s);
                  }
              });
          }
      } finally {
          s.depth.current--;
      }
  }

  static _isOp(k) {
      return ['$eq', '$gt', '$gte', '$in', '$lt', '$lte', '$ne', '$nin', '$and', '$not', '$nor', '$or', '$exists', '$type', '$mod', '$regex', '$text', '$where'].includes(k);
  }

  static _write(v, s, o) {
      const t = this._type(v);
      s.buffer[s.pos++] = t;

      const writers = {
    [TYPES.NULL]: () => {}
    , [TYPES.UNDEFINED]: () => {}
    , [TYPES.OBJECTID]: () => {
              s.buffer.set(v.id, s.pos);
              s.pos += 12;
          }
    , [TYPES.BOOLEAN]: () => {
              s.buffer[s.pos++] = v ? 1 : 0;
          }
    , [TYPES.DATE]: () => this._writeInt64(v.getTime(), s)
    , [TYPES.INT32]: () => this._writeInt32(v, s)
    , [TYPES.INT64]: () => this._writeInt64(v, s)
    , [TYPES.TIMESTAMP]: () => {
              this._writeInt32(v.low, s);
              this._writeInt32(v.high, s);
          }
    , [TYPES.SYMBOL]: () => this._writeString(v.value, s)
    , [TYPES.CODE]: () => {
              if (v.scope) {
                  const size = v.code.length + this._size(v.scope) + 8;
                  this._writeInt32(size, s);
                  this._writeString(v.code, s);
                  this._write(v.scope, s, o);
              } else {
                  this._writeString(v.code, s);
              }
          }
    , [TYPES.DECIMAL128]: () => {
              s.buffer.set(v.bytes, s.pos);
              s.pos += 16;
          }
    , [TYPES.REGEXP]: () => {
              const source = v.source;
              const flags = v.flags;
              s.pos += Buffer.from(source).copy(s.buffer, s.pos);
              s.buffer[s.pos++] = 0;
              s.pos += Buffer.from(flags).copy(s.buffer, s.pos);
              s.buffer[s.pos++] = 0;
          }
    , [TYPES.NUMBER]: () => {
              BUF.double[0] = v;
              s.buffer.set(new Uint8Array(BUF.double.buffer), s.pos);
              s.pos += 8;
          }
    , [TYPES.STRING]: () => {
              const size = Buffer.byteLength(v, 'utf8') + 1;
              this._writeInt32(size, s);
              s.pos += Buffer.from(v).copy(s.buffer, s.pos);
              s.buffer[s.pos++] = 0;
          }
    , [TYPES.OBJECT]: () => this._writeDoc(v, s, o)
    , [TYPES.ARRAY]: () => this._writeDoc(v, s, o, true)
      };

      (writers[t] || (() => {
          throw new BSONError('Unsupported type', 'INVALID_TYPE');
      }))();
  }

  static _type(v) {
      if (v === null) return TYPES.NULL;
      if (v === undefined) return TYPES.UNDEFINED;
      if (v instanceof ObjectId) return TYPES.OBJECTID;
      if (v instanceof SimpleClasses.BSONTimestamp) return TYPES.TIMESTAMP;
      if (v instanceof SimpleClasses.BSONSymbol) return TYPES.SYMBOL;
      if (v instanceof SimpleClasses.BSONCode) return v.scope ? TYPES.CODE_W_SCOPE : TYPES.CODE;
      if (v instanceof SimpleClasses.BSONDecimal128) return TYPES.DECIMAL128;
      if (v instanceof RegExp) return TYPES.REGEXP;
      if (typeof v === 'boolean') return TYPES.BOOLEAN;
      if (v instanceof Date) return TYPES.DATE;
      if (typeof v === 'number') return Number.isInteger(v) ?
          (v >= -2147483648 && v <= 2147483647 ? TYPES.INT32 : TYPES.INT64) : TYPES.NUMBER;
      if (typeof v === 'string') return TYPES.STRING;
      if (Array.isArray(v)) return TYPES.ARRAY;
      if (typeof v === 'object') return TYPES.OBJECT;
      throw new BSONError('Unsupported type', 'INVALID_TYPE');
  }

  static _writeInt32(v, s) {
      BUF.int32[0] = v;
      s.buffer.set(new Uint8Array(BUF.int32.buffer), s.pos);
      s.pos += 4;
  }

  static _writeInt64(v, s) {
      this._writeInt32(v % 0x100000000, s);
      this._writeInt32(Math.floor(v / 0x100000000), s);
  }

  static _writeString(v, s) {
      const size = Buffer.byteLength(v, 'utf8') + 1;
      this._writeInt32(size, s);
      s.pos += Buffer.from(v).copy(s.buffer, s.pos);
      s.buffer[s.pos++] = 0;
  }

  static _writeDoc(d, s, o, isArr = false) {
      const sizePos = s.pos;
      s.pos += 4;

      if (isArr) {
          d.forEach((v, i) => {
              this._write(i.toString(), s, o);
              this._write(v, s, o);
          });
      } else {
          Object.entries(d).forEach(([k, v]) => {
              this._write(k, s, o);
              this._write(v, s, o);
          });
      }

      s.buffer[s.pos++] = 0;
      const size = s.pos - sizePos;
      for (let i = 0; i < 4; i++) s.buffer[sizePos + i] = (size >> (i * 8)) & 0xFF;
  }
}

class BSONDeserializer {
  static deserialize(buf, opts = {}) {
      return this._read({
          buffer: new Uint8Array(buf)
          , pos: 0
          , opts
      });
  }

  static _read(s) {
      const t = s.buffer[s.pos++];

      const readers = {
    [TYPES.NULL]: () => null
    , [TYPES.UNDEFINED]: () => undefined
    , [TYPES.OBJECTID]: () => {
              const id = s.buffer.slice(s.pos, s.pos += 12);
              return new ObjectId(id);
          }
    , [TYPES.BOOLEAN]: () => Boolean(s.buffer[s.pos++])
    , [TYPES.DATE]: () => new Date(this._readInt64(s))
    , [TYPES.INT32]: () => this._readInt32(s)
    , [TYPES.INT64]: () => this._readInt64(s)
    , [TYPES.TIMESTAMP]: () => new SimpleClasses.BSONTimestamp(this._readInt32(s), this._readInt32(s))
    , [TYPES.SYMBOL]: () => new SimpleClasses.BSONSymbol(this._readString(s))
    , [TYPES.CODE]: () => new SimpleClasses.BSONCode(this._readString(s))
    , [TYPES.CODE_W_SCOPE]: () => {
              const size = this._readInt32(s);
              const code = this._readString(s);
              const scope = this._read(s);
              return new SimpleClasses.BSONCode(code, scope);
          }
    , [TYPES.DECIMAL128]: () => {
              const bytes = s.buffer.slice(s.pos, s.pos += 16);
              return new SimpleClasses.BSONDecimal128(bytes);
          }
    , [TYPES.REGEXP]: () => {
              let source = ''
                  , flags = '';
              while (s.buffer[s.pos] !== 0) source += String.fromCharCode(s.buffer[s.pos++]);
              s.pos++;
              while (s.buffer[s.pos] !== 0) flags += String.fromCharCode(s.buffer[s.pos++]);
              s.pos++;
              return new RegExp(source, flags);
          }
    , [TYPES.NUMBER]: () => {
              BUF.uint8.set(s.buffer.slice(s.pos, s.pos += 8));
              return BUF.double[0];
          }
    , [TYPES.STRING]: () => this._readString(s)
    , [TYPES.OBJECT]: () => this._readDoc(s)
    , [TYPES.ARRAY]: () => this._readDoc(s, true)
      };

      return (readers[t] || (() => {
          throw new BSONError(`Unknown type: ${t}`, 'UNKNOWN_TYPE');
      }))();
  }

  static _readInt32(s) {
      const v = s.buffer[s.pos] | (s.buffer[s.pos + 1] << 8) |
          (s.buffer[s.pos + 2] << 16) | (s.buffer[s.pos + 3] << 24);
      s.pos += 4;
      return v;
  }

  static _readInt64(s) {
      const l = this._readInt32(s)
          , h = this._readInt32(s);
      return h * 0x100000000 + (l >>> 0);
  }

  static _readString(s) {
      const size = this._readInt32(s);
      const str = Buffer.from(s.buffer.slice(s.pos, s.pos + size - 1)).toString('utf8');
      s.pos += size;
      return str;
  }

  static _readDoc(s, isArr = false) {
      const size = this._readInt32(s);
      const end = s.pos + size - 4;
      const result = isArr ? [] : {};

      while (s.pos < end - 1) {
          const k = this._read(s);
          const v = this._read(s);
          if (isArr) result[parseInt(k, 10)] = v;
          else result[k] = v;
      }

      s.pos = end;
      return result;
  }
}

module.exports = {
  BSONSerializer
  , BSONDeserializer
  , BSONError
  , ObjectId
  , ...SimpleClasses
  , BINARY
};
