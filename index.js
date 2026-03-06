const axios = require('axios');
const crypto = require('crypto');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// Initialize Secret Manager Client outside the function to reuse it across invocations (cold start)
const client = new SecretManagerServiceClient();

// Helper function to get secrets securely from Google Secret Manager
async function getSecret(secretName) {
    try {
        const [version] = await client.accessSecretVersion({
            name: `projects/${process.env.GCP_PROJECT_ID}/secrets/${secretName}/versions/latest`,
        });
        return version.payload.data.toString();
    } catch (error) {
        console.error(`Failed to access secret: ${secretName}`, error);
        throw new Error(`Could not retrieve secret: ${secretName}`);
    }
}

let secretsCache = {};
const secretNames = [
    'google-ads-client-id',
    'google-ads-client-secret',
    'google-ads-refresh-token',
    'google-ads-developer-token',
    'google-ads-customer-id',
    'cloud-function-api-key'
];

exports.sendGoogleAdsConversion = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed. Only POST requests are accepted.');
    }
    if (req.headers['content-type'] !== 'application/json') {
        return res.status(400).send('Content-Type must be application/json.');
    }

    const { email, phone, gclid, googleAdsConversionActionId, conversionValue, conversionCurrency } = req.body;

    if (!email && !gclid) {
        console.error('Error: Either email or gclid is required in the payload.');
        return res.status(400).json({ status: 'error', message: 'Either email or gclid is required for conversion.' });
    }

    try {
        if (Object.keys(secretsCache).length === 0) {
            console.log('Loading secrets from Secret Manager for the first time (cold start)...');
            for (const secretName of secretNames) {
                secretsCache[secretName.replace(/-/g, '_').toUpperCase()] = await getSecret(secretName);
            }
            console.log('Secrets loaded and cached.');
        }

        const {
            GOOGLE_ADS_CLIENT_ID,
            GOOGLE_ADS_CLIENT_SECRET,
            GOOGLE_ADS_REFRESH_TOKEN,
            GOOGLE_ADS_DEVELOPER_TOKEN,
            GOOGLE_ADS_CUSTOMER_ID,
            CLOUD_FUNCTION_API_KEY,
        } = secretsCache;

                // --- API Key Validation ---
        const incomingApiKey = req.headers['x-api-key']; // HubSpot will send it in this header

        if (!incomingApiKey || incomingApiKey !== CLOUD_FUNCTION_API_KEY) {
            console.warn('Unauthorized attempt to invoke function: Invalid or missing API Key.');
            return res.status(401).json({ status: 'error', message: 'Unauthorized: Invalid API Key.' });
        }


        // --- DEBUG LOGS START HERE ---
        //console.log('DEBUG: GOOGLE_ADS_CUSTOMER_ID retrieved:', GOOGLE_ADS_CUSTOMER_ID);
        //console.log('DEBUG: Length of GOOGLE_ADS_CUSTOMER_ID:', GOOGLE_ADS_CUSTOMER_ID.length);
        // Convert to hex to show any non-printable characters for customer ID
        //console.log('DEBUG: Hex of GOOGLE_ADS_CUSTOMER_ID:', Buffer.from(GOOGLE_ADS_CUSTOMER_ID).toString('hex'));
        // --- DEBUG LOGS END HERE ---

        console.log('Attempting to refresh Google Ads access token using the refresh token...');
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
                client_id: GOOGLE_ADS_CLIENT_ID,
                client_secret: GOOGLE_ADS_CLIENT_SECRET,
                refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
                grant_type: 'refresh_token',
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        const accessToken = tokenResponse.data.access_token;
        console.log('Successfully obtained new access token.');

        const hashedEmail = email ? crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex') : null;
        const hashedPhone = phone ? crypto.createHash('sha256').update(phone.trim().toLowerCase()).digest('hex') : null;

        // --- Date/Time Formatting ---
        // Format the current date/time to "YYYY-MM-DD HH:MM:SS+/-HH:MM"
        const now = new Date();
        const pad = (num) => num < 10 ? '0' + num : num;

        const year = now.getFullYear();
        const month = pad(now.getMonth() + 1); // Month is 0-indexed
        const day = pad(now.getDate());
        const hours = pad(now.getHours());
        const minutes = pad(now.getMinutes());
        const seconds = pad(now.getSeconds());

        const offsetMinutes = now.getTimezoneOffset();
        const offsetSign = offsetMinutes > 0 ? '-' : '+';
        const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
        const offsetMins = pad(Math.abs(offsetMinutes) % 60);

        const conversionDateTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMins}`;
        // --- End Date/Time Formatting ---

        // --- CONVERSION DATA OBJECT DEFINITION  ---
        const conversionData = {
            conversionAction: `customers/${GOOGLE_ADS_CUSTOMER_ID}/conversionActions/${googleAdsConversionActionId}`,
            conversionDateTime: conversionDateTime,
            userIdentifiers: [],
        };
        // --- END CONVERSION DATA OBJECT DEFINITION ---

        // Add properties to conversionData
        if (gclid) {
            conversionData.gclid = gclid;
        }
        if (hashedEmail) {
            conversionData.userIdentifiers.push({ hashedEmail: hashedEmail });
        }
        if (hashedPhone) {
            conversionData.userIdentifiers.push({ hashedPhoneNumber: hashedPhone });
        }
        if (conversionValue) {
            conversionData.conversionValue = parseFloat(conversionValue);
        }
        if (conversionCurrency) {
            conversionData.currencyCode = conversionCurrency;
        }

        // Google Ads API endpoint for conversions
        const apiUrl = `https://googleads.googleapis.com/v20/customers/${GOOGLE_ADS_CUSTOMER_ID}:uploadClickConversions`;

        // --- DEBUG LOGS START HERE ---
        //console.log('DEBUG: Final apiUrl constructed:', apiUrl);
        //console.log('DEBUG: Length of final apiUrl:', apiUrl.length);
        // Convert to hex to show any non-printable characters for the URL
        //console.log('DEBUG: Hex of final apiUrl:', Buffer.from(apiUrl).toString('hex'));
        // --- DEBUG LOGS END HERE ---

        console.log('Sending conversion data to Google Ads API...');
        const googleAdsResponse = await axios.post(
            apiUrl,
            {
                conversions: [conversionData],
                partialFailure: true
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );

        console.log('Google Ads API Response (data):', JSON.stringify(googleAdsResponse.data));
        console.log('Successfully sent conversion to Google Ads.');

        res.status(200).json({
            status: 'success',
            message: 'Conversion sent to Google Ads successfully.',
            googleAdsResponse: googleAdsResponse.data
        });

    } catch (error) {
        console.error('Error in Cloud Function during Google Ads API call or token refresh:', error.message);
        if (error.response) {
            console.error('API Error Details (status, data, headers):', error.response.status, JSON.stringify(error.response.data, null, 2), error.response.headers);
            if (error.response.data && error.response.data.errors) {
                error.response.data.errors.forEach(err => {
                    console.error(`Google Ads Error Code: ${err.errorCode?.errorCode || 'N/A'}, Message: ${err.message}`);
                });
            }
        } else if (error.request) {
            console.error('No response received from API:', error.request);
        } else {
            console.error('Error during request setup:', error.message);
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to send conversion to Google Ads.',
            details: error.message,
            googleAdsErrorResponse: error.response ? error.response.data : null
        });
    }
};