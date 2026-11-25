(AI-GENERATED. TESTED AND THIS IS NOT AN ENCOURAGEMENT OF AI-SLOP! THANKS, BUILDVERSE!)

# Independent F3X Import / Export

A community project for storing F3X build data behind a small HTTP API. The source code lives in this GitHub repository; the API is designed to run on **Cloudflare Workers + D1**.

> **Status: starter backend only.** This repository does not yet contain a finished Roblox/F3X plugin. The old RBXM files have not been safely verified as reusable source, so this project does not copy their code or claim official F3X endorsement.

## What is included

- `src/index.js` — Cloudflare Worker API.
- `schema.sql` — D1 database table.
- `wrangler.toml` — Worker and D1 configuration template.

## API

- `GET /` — health/status response.
- `POST /api/builds` — save a JSON build and receive a short code.
- `GET /api/builds/:code` — retrieve a saved build by code.

Saved builds expire after 30 days by default. The API rejects malformed JSON and payloads larger than 512 KiB.

## Free setup (when your Cloudflare account is ready)

1. Create a Cloudflare D1 database named `f3x-builds`.
2. Copy the database ID into `wrangler.toml` where it says `REPLACE_WITH_D1_DATABASE_ID`.
3. In a terminal with Node.js and Wrangler installed, run:

   ```sh
   npx wrangler d1 execute f3x-builds --remote --file=./schema.sql
   npx wrangler deploy
   ```

4. Wrangler will show the Worker URL, normally ending in `.workers.dev`.

You can also create the D1 database and deploy from the Cloudflare dashboard. Do not publish database credentials or account API tokens.

## Important security note

This initial API is intentionally a small prototype. Anyone who discovers the public Worker URL can submit builds or retrieve a build if they know its code. Random codes make guessing harder, but they are **not user authentication**. Before using this for a public game, add abuse protection and decide who is allowed to upload, delete, and retrieve data. Never put a Cloudflare account token or database secret in a Roblox LocalScript or plugin.

## Next step

The Roblox plugin still needs to be connected to these endpoints. That requires inspecting and adapting verified plugin source; it is not included or claimed to be complete here.

## Deployment status

- The dedicated Cloudflare D1 database has been created and its schema applied.
- The Worker `independent-f3x-api` has been uploaded with the D1 binding.
- The Worker does not yet have a public `workers.dev` address. Choose and configure the account's workers.dev subdomain before publishing the API URL.
- `index.html` is the first companion-page draft. GitHub Pages still needs to be enabled in the repository settings, and its API address must be filled in after the Worker URL is known.

The website and Roblox plugin are separate pieces: this page currently retrieves a build as JSON; the Roblox F3X plugin integration is still being developed.
