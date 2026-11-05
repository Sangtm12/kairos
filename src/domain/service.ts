export type Service = {
  id: string;
  providerId: string;
  title: string;
  durationMinutes: number;
  priceMinor: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  createdAt: Date;
  updatedAt: Date;
};
