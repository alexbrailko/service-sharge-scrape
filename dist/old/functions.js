"use strict";
// export const addServiceChargeHistory = async (
//   listings: ListingNoId[],
//   prisma: PrismaClient
// ) => {
//   let filteredListings = listings;
Object.defineProperty(exports, "__esModule", { value: true });
//   for (const listing of listings) {
//     const matchedAddressListing = await prisma.listing.findFirst({
//       where: {
//         addressFull: {
//           equals: listing.addressFull,
//         },
//         beds: {
//           equals: listing.beds,
//         },
//       },
//     });
//     if (
//       matchedAddressListing &&
//       compareNumberDifference(
//         matchedAddressListing.serviceCharge,
//         listing.serviceCharge
//       )
//     ) {
//       let serviceChargeHistory = '';
//       if (matchedAddressListing.serviceChargeHistory) {
//         const data: ServiceChargeHistory[] = JSON.parse(
//           matchedAddressListing.serviceChargeHistory
//         );
//         data.push({
//           datePosted: listing.datePosted,
//           serviceCharge: listing.serviceCharge,
//           url: matchedAddressListing.url,
//         });
//         serviceChargeHistory = JSON.stringify(data);
//       } else {
//         const data: null | ServiceChargeHistory[] = [
//           {
//             datePosted: matchedAddressListing.datePosted,
//             serviceCharge: matchedAddressListing.serviceCharge,
//             url: matchedAddressListing.url,
//           },
//           {
//             datePosted: listing.datePosted,
//             serviceCharge: listing.serviceCharge,
//             url: listing.url,
//           },
//         ];
//         serviceChargeHistory = JSON.stringify(data);
//       }
//       // if dates are at least 3 motnh apart
//       if (
//         isNMonthsApart(matchedAddressListing.datePosted, listing.datePosted, 3)
//       ) {
//         await prisma.listing.update({
//           where: {
//             id: matchedAddressListing.id,
//           },
//           data: {
//             serviceChargeHistory: serviceChargeHistory,
//             serviceCharge: listing.serviceCharge,
//           },
//         });
//       }
//     }
//     if (matchedAddressListing) {
//       filteredListings = filteredListings.filter(
//         (l) => l.addressFull !== matchedAddressListing.addressFull
//       );
//     }
//   }
//   return filteredListings;
// };
//# sourceMappingURL=functions.js.map