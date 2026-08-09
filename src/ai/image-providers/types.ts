export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio: '2:3' | '1:1' | '4:3' | '16:9';
  style?: string;
  referenceImageUrl?: string;
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  aspectRatio: string;
  createdAt: Date;
}

export interface ImageProvider {
  name: string;
  generateImage(req: ImageGenerationRequest): Promise<GeneratedImage>;
}
