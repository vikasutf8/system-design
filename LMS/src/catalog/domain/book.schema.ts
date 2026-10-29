import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * MongoDB catalog document (LLD 8.1). `_id` is the external bookId (for
 * example "b-demo-1"), so Debezium change events and the Elasticsearch
 * document share the same identifier.
 */
@Schema({ collection: 'books', versionKey: false, timestamps: false })
export class Book {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true })
  isbn: string;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: [String], default: [] })
  authors: string[];

  @Prop({ type: [String], default: [] })
  genres: string[];

  @Prop({ type: String, required: true, default: 'en' })
  language: string;

  @Prop({ type: Number })
  publicationYear?: number;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ type: Date, required: true })
  updatedAt: Date;
}

export const BookSchema = SchemaFactory.createForClass(Book);

// Unique ISBN is the catalog invariant from LLD 8.1.
BookSchema.index({ isbn: 1 }, { unique: true });

export interface BookRecord {
  _id: string;
  isbn: string;
  title: string;
  authors: string[];
  genres: string[];
  language: string;
  publicationYear?: number;
  tags: string[];
  description?: string;
  updatedAt: Date;
}
