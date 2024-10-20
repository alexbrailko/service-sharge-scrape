import { Listing } from '@prisma/client';

export interface ListingMainPage {
  url: string;
  listingPrice: number;
  datePosted: Date;
}

export type ListingNoId = Omit<Listing, 'id'>;

export interface ServiceChargeHistory {
  datePosted: Date;
  serviceCharge: number;
  url: string;
}
