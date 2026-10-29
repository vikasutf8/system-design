// =============================================================================
// Catalog source of truth (MongoDB). The NestJS catalog service writes here.
// Debezium reads the replica-set change stream and publishes every change to
// Kafka; the ES indexer consumes that topic. The app never dual-writes ES.
// =============================================================================

const lms = db.getSiblingDB('lms');

lms.books.createIndex({ isbn: 1 }, { unique: true });
lms.books.createIndex({ title: 'text', authors: 'text', tags: 'text' });

const books = [
  {
    _id: 'b-demo-1',
    isbn: '9781449373320',
    title: 'Designing Data-Intensive Applications',
    authors: ['Martin Kleppmann'],
    genres: ['computing'],
    language: 'en',
    publicationYear: 2017,
    tags: ['databases', 'distributed systems', 'architecture'],
    description: 'The big ideas behind reliable, scalable and maintainable systems.',
    updatedAt: new Date(),
  },
  {
    _id: 'b-demo-2',
    isbn: '9780132350884',
    title: 'Clean Code',
    authors: ['Robert C. Martin'],
    genres: ['computing'],
    language: 'en',
    publicationYear: 2008,
    tags: ['programming', 'craftsmanship'],
    description: 'A handbook of agile software craftsmanship.',
    updatedAt: new Date(),
  },
  {
    _id: 'b-demo-3',
    isbn: '9780262033848',
    title: 'Introduction to Algorithms',
    authors: ['Thomas H. Cormen', 'Charles E. Leiserson', 'Ronald L. Rivest', 'Clifford Stein'],
    genres: ['computing', 'mathematics'],
    language: 'en',
    publicationYear: 2009,
    tags: ['algorithms', 'data structures'],
    description: 'A comprehensive introduction to modern algorithms.',
    updatedAt: new Date(),
  },
];

// Idempotent seed: re-running the stack must not fail on duplicate ids.
for (const book of books) {
  lms.books.replaceOne({ _id: book._id }, book, { upsert: true });
}
