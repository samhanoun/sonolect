export interface SonolectClientOptions {
  baseUrl: string;
  getIdToken: () => Promise<string>;
}

export class SonolectClient {
  constructor(private readonly options: SonolectClientOptions) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.options.getIdToken();
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      throw new Error(`Sonolect API error ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}
