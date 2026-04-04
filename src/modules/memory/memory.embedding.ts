export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

export class OpenAIEmbedding implements EmbeddingProvider {
  readonly dimensions = 1536;
  private apiKey: string;
  private model = 'text-embedding-3-small';

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? Bun.env.OPENAI_API_KEY ?? '';
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json() as any;
    return data.data.map((d: any) => d.embedding);
  }
}

export class NoOpEmbedding implements EmbeddingProvider {
  readonly dimensions = 1536;
  async embed(_text: string): Promise<number[]> {
    return new Array(this.dimensions).fill(0);
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dimensions).fill(0));
  }
}

let _provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!_provider) {
    _provider = Bun.env.OPENAI_API_KEY ? new OpenAIEmbedding() : new NoOpEmbedding();
  }
  return _provider;
}
