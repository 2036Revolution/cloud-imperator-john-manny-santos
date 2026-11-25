# Independent F3X Import / Export

A community project for importing and exporting F3X-compatible build data through a dedicated Cloudflare Worker and D1 database.

## Components

- `src/index.js` — API for saving and retrieving JSON build payloads.
- `schema.sql` — database schema for builds, membership cache, rate limits, nonces, and export cooldowns.
- `wrangler.toml` — Worker and D1 binding configuration.

A combined Roblox Studio plugin has been prepared separately from the original user-provided import plugin. It keeps the original import serialization formats (V1/V2/V3) and uses the original V3 format for newly exported builds so that the original importer can read them. MeshParts are converted to Part + SpecialMesh for compatibility; some Roblox-only instance types and visual features outside the original serializer's supported set are not exported. The plugin artifact is not checked into this repository yet because its API URL still needs to be configured.

## API

- `GET /` — service status.
- `POST /api/builds` — save a JSON build and receive a four-character code.
- `GET /api/builds/:code` — retrieve a build by code.

All API build operations require the plugin-supplied Roblox UserId, a fresh timestamp, a one-time nonce, and membership in Roblox group **10608653**. The server checks membership and caches the result for 30 minutes.

### Build storage and codes

- Builds do not expire automatically. The original creation timestamp is retained in `created_at`.
- `last_accessed` is updated when a build is retrieved.
- Four-character codes use a 32-character alphabet (just over one million possible codes). A small explicit denylist prevents several obvious offensive codes from being assigned.
- If every usable code is occupied, the least-recently-accessed build is recycled first. This is an emergency capacity policy, not normal cleanup.
- Each build is limited to 512 KiB.
- The database stores the build payload and creation/access timestamps.

### Export abuse controls

- The plugin disables its Export button for one second after a click.
- The API independently enforces a one-second per-user export cooldown.
- Repeated rapid export attempts trigger a 20-second server-side pause.
- Additional limits are 12 authenticated requests per user per minute and 30 per source IP per minute.
- Request nonces are one-use and expired nonce records are cleaned up.

## Security limitations

The API verifies that the submitted UserId belongs to the required group, but a UserId supplied by a client plugin is not cryptographic proof of identity. A modified client could forge the header. Timestamp freshness, nonces, group checks, and rate limits reduce casual abuse and replay, but they do not provide the same guarantee as a server-signed identity token. Do not put Cloudflare account tokens or database credentials in the plugin.

## Deployment status

- Dedicated Cloudflare D1 database: created and migrated.
- Worker: deployed with the D1 binding.
- Public `workers.dev` API subdomain: not configured yet. The public website will remain on GitHub Pages; the Worker URL is only the plugin's API endpoint.
- GitHub Pages: not enabled yet.
- The combined RBXM currently contains an API URL placeholder. Replace it with the Worker API URL after the public API subdomain is selected.

This is an independent community project and is not affiliated with or endorsed by Roblox or the F3X creators.
