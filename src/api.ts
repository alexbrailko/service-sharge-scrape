interface AddressData {
  addressFull: string;
  postCode: string;
}

export const getAddressData = async (coordinates: string) => {
  const bingResponse = await getAddressDataBing(coordinates);

  if (bingResponse) {
    return bingResponse;
  }

  const openStreetMapData = await getAddressDataOpenStreetMap(coordinates);

  if (openStreetMapData) {
    return openStreetMapData;
  }

  const geoapifyData = await getAddressDataGeoapify(coordinates);

  return geoapifyData;
};

export const getAddressDataGeoapify = async (
  coordinates: string
): Promise<AddressData | false> => {
  const coords = coordinates.split(/\s*,\s*/) || [];
  const req = `https://api.geoapify.com/v1/geocode/reverse?lat=${coords[0]}&lon=${coords[1]}&limit=1&format=json&apiKey=${process.env.GEOAPIFY_API_KEY}`;

  const res = await fetch(req)
    .then((response) => response.json())
    .then((data) => {
      if (data.results.length) {
        const d = data.results[0];
        const notBuildingCategory =
          !d.category ||
          d.category !== 'building.residential' ||
          d.category !== 'accommodation' ||
          d.category !== 'building.accommodation';

        if (
          d.result_type === 'street' ||
          (d.result_type === 'amenity' && notBuildingCategory)
        ) {
          return false;
        }

        const newData = {
          addressFull: d.formatted || '',
          postCode: d.postcode || '',
        };

        return newData;
      } else {
        return false;
      }
    })
    .catch((error) => {
      console.log('Error geoapify api request:', error);
      // Never return here, indicating an error situation
      throw error; // Re-throw the error for potential handling elsewhere
    });

  return res;
};

export const getAddressDataOpenStreetMap = async (
  coordinates: string
): Promise<AddressData | false> => {
  const coords = coordinates.split(/\s*,\s*/) || [];
  const req = `https://nominatim.openstreetmap.org/reverse?lat=${coords[0]}&lon=${coords[1]}&format=jsonv2`;

  const res = await fetch(req)
    .then((response) => response.json())
    .then((data) => {
      if (data && data.addresstype === 'building') {
        return {
          addressFull: data.display_name,
          postCode: data.address.postcode,
        };
      } else {
        return false;
      }
    })
    .catch((error) => {
      console.log('Error OpenStreetMap api request:', error);
      // Never return here, indicating an error situation
      throw error; // Re-throw the error for potential handling elsewhere
    });

  return res;
};

export const getPostcodeBing = async (
  address: string
): Promise<string | false> => {
  try {
    // Encode the address string
    const encodedAddress = encodeURIComponent(address);

    const url = `https://dev.virtualearth.net/REST/v1/Locations?query=${encodedAddress}&key=${process.env.BING_API_KEY}`;

    const response = await fetch(url);

    // Check if the response is successful
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    // Parse the JSON response
    const data = await response.json();

    if (
      data.resourceSets &&
      data.resourceSets.length > 0 &&
      data.resourceSets[0].resources.length > 0
    ) {
      const postcode = data.resourceSets[0].resources[0].address.postalCode;

      return postcode;
    } else {
      console.log('No results found for the provided address.');
      return '';
    }
  } catch (error) {
    console.error('There was a problem with the fetch operation:', error);
    throw error;
  }
};

export const getAddressDataBing = async (
  coordinates: string
): Promise<AddressData | false> => {
  const res = await fetch(
    `https://dev.virtualearth.net/REST/v1/Locations/${coordinates}?key=${process.env.BING_API_KEY}`
  )
    .then((response) => response.json())
    .then((data) => {
      if (
        data.resourceSets.length &&
        data.resourceSets[0]?.resources[0]?.confidence === 'High'
      ) {
        const address = data.resourceSets[0]?.resources[0]?.address;

        return {
          addressFull: address.formattedAddress,
          postCode: address.postalCode,
        };
      } else {
        return false;
      }
    })
    .catch((e) => {
      console.log('Error bing api reguest', e);
      throw e;
    });

  return res;
};

export const modifyCoordinatesBing = async (address: string) => {
  //get more precise coordinates of house location
  try {
    // Encode the address string
    const encodedAddress = encodeURIComponent(address);

    // Construct the URL for the Geocoding API
    const url = `https://dev.virtualearth.net/REST/v1/Locations?query=${encodedAddress}&key=${process.env.BING_API_KEY}`;

    // Make the HTTP request
    const response = await fetch(url);

    // Check if the response is successful
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    // Parse the JSON response
    const data = await response.json();

    // Extract latitude and longitude from the response
    if (
      data.resourceSets &&
      data.resourceSets.length > 0 &&
      data.resourceSets[0].resources.length > 0
    ) {
      const coordinates = data.resourceSets[0].resources[0].point.coordinates;
      const latitude = coordinates[0];
      const longitude = coordinates[1];

      return latitude + ',' + longitude;
    } else {
      console.log('No results found for the provided address.');
    }
  } catch (error) {
    console.error('There was a problem with the fetch operation:', error);
  }
};

export const getMapPictureUrl = async (
  coords: string,
  type: string = 'BirdsEye',
  count: number = 0
): Promise<string> => {
  try {
    const imgResponse = await fetch(
      `https://dev.virtualearth.net/REST/v1/Imagery/Map/${type}/${coords}/19?mapSize=760,460&pp=${coords};128;&mapLayer=Basemap,Buildings&key=${process.env.BING_API_KEY}`
    );

    if (imgResponse.status !== 200 && !count) {
      count++;
      return getMapPictureUrl(coords, 'Aerial');
    }
    if (count) {
      count = 0;
    }

    return imgResponse?.url;
  } catch (e) {
    console.log('Error getMapPicture', e);
  }
};
