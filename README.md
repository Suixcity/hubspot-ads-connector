# HubSpot Ads Connector

Custom conversion event pipeline from HubSpot to Google Ads and LinkedIn Ads. Sends rich, product-specific signals beyond what the native HubSpot connectors support — enabling ad platforms to optimize for events that actually matter to your business.

## The Problem

The native HubSpot ↔ Google Ads and LinkedIn Ads connectors are limited to lifecycle stage changes and form fills. For SaaS or product-led growth businesses, the most valuable conversion signals — trial signups, free-to-paid upgrades, enterprise deals closing — don't map cleanly to those primitives. Without richer feedback, ad network optimization engines are working blind.

## What It Does

Three HubSpot workflows fire conversion events to both Google Ads and LinkedIn Ads when:

| Workflow | Trigger |
|---|---|
| Account Signup | Contact completes product signup |
| Paid Upgrade | Free account converts to paid |
| Deal Closed | Enterprise deal reaches Closed Won |

Each workflow runs two actions in sequence: a webhook to the Google Ads Cloud Function, then a LinkedIn custom coded action.

## Components

### `index.js` — Google Ads Cloud Function

Deployed on Google Cloud Functions. Called from HubSpot workflows via webhook action.

- Authenticates callers via `x-api-key` header
- Pulls Google Ads credentials from GCP Secret Manager at cold start, then caches
- Refreshes OAuth access token per invocation
- SHA-256 hashes email and phone before sending
- Accepts dynamic `conversionValue` and `conversionCurrency` (static fallback supported)
- Posts to Google Ads Conversions API (`uploadClickConversions`)

**Payload fields (from HubSpot workflow):**

| Field | Required | Notes |
|---|---|---|
| `email` | One of email or gclid | SHA-256 hashed before sending |
| `phone` | No | SHA-256 hashed before sending |
| `gclid` | One of email or gclid | Google Click ID from ad click |
| `googleAdsConversionActionId` | Yes | Unique per workflow/event type |
| `conversionValue` | No | Deal amount or static fallback |
| `conversionCurrency` | No | Defaults to account currency if omitted |

### `linkedin-workflow-action.js` — LinkedIn Custom Coded Action

Runs natively inside HubSpot's workflow engine as a custom coded action. One instance per workflow, each with its own `{{conversion_id}}`.

- Reads `linkedin_access_token` from HubSpot's built-in secret store
- SHA-256 hashes email before sending
- Sends first name, last name, and hashed email to LinkedIn Conversions API
- Returns `api_status` (success/error) and `api_response` as output fields for workflow branching

## Requirements

- Google Cloud project with Secret Manager enabled
- Google Ads developer token (requires Google review for standard access)
- Google Ads OAuth credentials (client ID, client secret, refresh token)
- Google Ads customer ID and conversion actions configured in Google Ads Manager
- LinkedIn Ads account with conversion events created in Signals Manager
- HubSpot Operations Hub (for custom coded actions)

## Setup

### Google Ads

1. Apply for a Google Ads developer token in your Google Ads Manager account. Standard access requires a Google review.
2. Create OAuth 2.0 credentials in Google Cloud Console. Generate a refresh token using the OAuth playground or a local script.
3. Link your Google Ads customer account to the manager account.
4. Create conversion actions in Google Ads for each event type. Note the numeric conversion action IDs.
5. Store the following in GCP Secret Manager:
   - `google-ads-client-id`
   - `google-ads-client-secret`
   - `google-ads-refresh-token`
   - `google-ads-developer-token`
   - `google-ads-customer-id`
   - `cloud-function-api-key` (any secure random string — used to authenticate HubSpot)
6. Deploy `index.js` as a Cloud Function. Set `GCP_PROJECT_ID` as an environment variable.
7. In each HubSpot workflow, add a webhook action pointing to the Cloud Function URL with `x-api-key` header and the conversion-specific payload.

### LinkedIn Ads

1. In LinkedIn Campaign Manager, go to **Data → Signals Manager → Direct API**.
2. Create a conversion event for each workflow. Note the numeric ID from the conversion URN.
3. Generate an access token from the same Signals Manager interface.
4. Store the token in HubSpot's secret store as `linkedin_access_token`.
5. In each HubSpot workflow, add a custom coded action using `linkedin-workflow-action.js`. Replace `{{conversion_id}}` with the event-specific ID. Add `email`, `firstName`, and `lastName` as input properties.

## Tech Stack

- **Runtime:** Node.js 18+
- **Google Ads:** Google Ads API v20 (`uploadClickConversions`)
- **LinkedIn:** LinkedIn Conversions API (`/rest/conversionEvents`)
- **Infrastructure:** Google Cloud Functions, GCP Secret Manager
- **HubSpot:** Workflow webhook action (Google) + custom coded action (LinkedIn)

## Notes

- Ad network conversion reporting is not real-time. Allow 12–24 hours for conversions to appear in campaign dashboards after a successful API response.
- Both integrations hash PII (email, phone) via SHA-256 before transmission. Raw contact data never leaves HubSpot.
- The Google Ads Cloud Function uses secret caching to avoid Secret Manager calls on every warm invocation.
