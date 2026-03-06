// linkedin access token added as the secret 'linkedin_access_token'
// email, firstName, and lastName all added to the properties to include.
// api_response added as a string output, api_status added as enumeration output with values 'success' and 'error' for easier workflow branching.

const axios = require('axios');
const crypto = require('crypto');

exports.main = async (event, callback) => {
  // 1. Get the data from the HubSpot workflow properties
  const email = event.inputFields['email'];
  const firstName = event.inputFields['firstName'];
  const lastName = event.inputFields['lastName'];

  // 2. Hash the email address using SHA256
  // LinkedIn requires the email to be lowercase and without leading/trailing whitespace before hashing.
  const hashedEmail = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');

  // 3. Define the API endpoint and headers
  const apiUrl = 'https://api.linkedin.com/rest/conversionEvents';
  const accessToken = process.env.linkedin_access_token;
  const conversionUrn = 'urn:lla:llaPartnerConversion:{{conversion_id}}';

  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
    'LinkedIn-Version': 202507,
  };

  // 4. Construct the request body
  const requestBody = {
    "conversion": conversionUrn,
    "conversionHappenedAt": Date.now(), // Milliseconds since epoch
    "conversionValue": { // Optional, but recommended for optimization
      "currencyCode": "USD",
      "amount": "1.00"
    },
    "user": {
      "userIds": [{
        "idType": "SHA256_EMAIL",
        "idValue": hashedEmail
      }],
      "userInfo": {
        "firstName": firstName,
        "lastName": lastName
      }
    }
  };

    console.log('Sending to LinkedIn API:', JSON.stringify(requestBody, null, 2));

 
  // 5. Make the API call using Axios
  try {
    const response = await axios.post(apiUrl, requestBody, { headers });
    console.log('LinkedIn API Response:', response.data);
    callback({
      outputFields: {
        api_status: 'success',
        api_response: JSON.stringify(response.data)
      }
    });
  } catch (error) {
    console.error('LinkedIn API Error:', error.response ? error.response.data : error.message);
    callback({
      outputFields: {
        api_status: 'error',
        api_response: JSON.stringify(error.response ? error.response.data : { message: error.message })
      }
    });
  }
};