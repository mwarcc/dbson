# dbson
A lightweight, zero-dependency BSON (Binary JSON) implementation for Node.js. This library provides serialization and deserialization of BSON documents with support for all BSON data types.

## Features

- 🚀 Zero dependencies
- 💪 Full BSON spec compliance
- 🔒 Circular reference detection
- 🎯 TypeScript-friendly
- ⚡ High performance
- 🛡️ Built-in validation
- 📦 Support for all BSON types

## Installation

```bash
npm install node-bson-serializer
```

## Usage

### Basic Usage

```javascript
const { BSONSerializer, BSONDeserializer, ObjectId } = require('node-bson-serializer');

// Serialize a document
const doc = {
  _id: new ObjectId(),
  name: "John Doe",
  age: 30,
  created: new Date(),
  scores: [95, 87, 91]
};

const bson = BSONSerializer.serialize(doc);
const decoded = BSONDeserializer.deserialize(bson);
console.log(decoded);
```

### Working with ObjectId

```javascript
const { ObjectId } = require('node-bson-serializer');

// Create a new ObjectId
const id = new ObjectId();

// Create from existing 12-byte buffer
const buffer = new Uint8Array(12);
const idFromBuffer = new ObjectId(buffer);

// Get timestamp from ObjectId
const timestamp = id.getTimestamp();

// Convert to string
const str = id.toString(); // Returns 24-character hex string

// Compare ObjectIds
const equals = id.equals(idFromBuffer);
```

### Special Types

```javascript
const {
  BSONTimestamp,
  BSONSymbol,
  BSONCode,
  BSONDecimal128
} = require('node-bson-serializer');

const doc = {
  // JavaScript code with scope
  code: new BSONCode('function() { return x + y; }', { x: 1, y: 2 }),
  
  // Timestamp (high, low)
  timestamp: new BSONTimestamp(0, Date.now()),
  
  // Symbol
  symbol: new BSONSymbol('sym'),
  
  // Decimal128
  decimal: new BSONDecimal128(new Uint8Array(16))
};
```

### Error Handling

```javascript
const { BSONSerializer, BSONError } = require('node-bson-serializer');

try {
  const doc = {
    nested: {
      deeply: {
        // This will cause an error if maxDepth is set to 2
        nested: { value: 1 }
      }
    }
  };
  
  const bson = BSONSerializer.serialize(doc, { maxDepth: 2 });
} catch (err) {
  if (err instanceof BSONError) {
    console.error(\`Error: \${err.message}\`);
    console.error(\`Code: \${err.code}\`);
    console.error(\`Path: \${err.details.path}\`);
  }
}
```

## Supported BSON Types

| Type | Description |
|------|-------------|
| Number | Double precision floating-point |
| String | UTF-8 string |
| Object | Embedded document |
| Array | Array |
| Binary | Binary data |
| ObjectId | 12-byte ObjectId |
| Boolean | true/false |
| Date | DateTime |
| Null | Null value |
| RegExp | Regular expression |
| Code | JavaScript code |
| Symbol | Symbol |
| Code w/ Scope | JavaScript code w/ scope |
| Int32 | 32-bit integer |
| Timestamp | BSON Timestamp |
| Int64 | 64-bit integer |
| Decimal128 | 128-bit decimal |
| Min Key | Min key |
| Max Key | Max key |

## API Reference

### BSONSerializer

#### \`serialize(data, options)\`

Serializes JavaScript objects into BSON format.

Options:
- \`maxDepth\`: Maximum depth for nested objects (default: 100)

### BSONDeserializer

#### \`deserialize(buffer, options)\`

Deserializes BSON data into JavaScript objects.

### ObjectId

- \`constructor(id?: Uint8Array)\`: Create new ObjectId
- \`toString()\`: Convert to 24-character hex string
- \`equals(other: ObjectId)\`: Compare with another ObjectId
- \`getTimestamp()\`: Get creation timestamp

## Error Codes

| Code | Description |
|------|-------------|
| CIRCULAR_REFERENCE | Circular reference detected |
| MAX_DEPTH_EXCEEDED | Maximum depth exceeded |
| INVALID_KEY | Invalid key in document |
| INVALID_TYPE | Unsupported or invalid type |
| SERIALIZE_ERROR | General serialization error |
| UNKNOWN_TYPE | Unknown BSON type |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details
