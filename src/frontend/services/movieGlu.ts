const MOVIEGLU_BASE_URL = "https://api-gate2.movieglu.com/";

export const fetchNearbyCinemas = async (
  latitude: string,
  longitude: string,
) => {
  const deviceTimestamp = new Date().toISOString();
  const geolocationString = `${latitude};${longitude}`;

  try {
    const response = await fetch(`${MOVIEGLU_BASE_URL}cinemasNearby/?n=10`, {
      method: "GET",
      headers: {
        client: "INDE_6",
        "x-api-key": "WqsKdJpIYI9SwtFQygTKN9M0ocksVeoxals8pVzl",
        authorization: "Basic SU5ERV82X1hYOnoxZXNZZ1Z1M2lsaQ==",
        "api-version": "v201",
        territory: "XX",
        "device-datetime": deviceTimestamp,
        geolocation: geolocationString,
      },
    });

    const text = await response.text();
    console.log("[MovieGlu Raw Response]", text); // see what's coming back

    const data = JSON.parse(text);
    return data.cinemas || [];
  } catch (error) {
    console.error("[MovieGlu Error]", error);
    return [];
  }
};
