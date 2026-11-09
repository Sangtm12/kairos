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

// What it takes to create a service — independent of any HTTP request shape.
export type NewService = Pick<Service, 'providerId' | 'title' | 'durationMinutes' | 'priceMinor'> &
  Partial<Pick<Service, 'bufferBeforeMinutes' | 'bufferAfterMinutes'>>;

// The fields that may change after creation.
export type ServiceChanges = Partial<
  Pick<
    Service,
    'title' | 'durationMinutes' | 'priceMinor' | 'bufferBeforeMinutes' | 'bufferAfterMinutes'
  >
>;
