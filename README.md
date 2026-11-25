# Independent F3X Import / Export

> **Development disclosure:** This project was developed with substantial assistance from AI tools using an AI-assisted approach often called “vibe-coding.” The project direction, requirements, and decisions are human-directed. AI assistance is not a security audit, and the project should not be assumed bug-free or production-hardened.

A community project for importing and exporting F3X-compatible build data through a dedicated Cloudflare Worker and D1 database.

## Components

- `src/index.js` — API for saving and retrieving JSON build payloads.
- `schema.sql` — database schema for builds, membership cache, rate limits, nonces, and export cooldowns.
- `wrangler.toml` — Worker and D1 binding configuration.
- `index.html` — public project information and development disclosure.

A combined Roblox Studio plugin is being developed separately. The intended approach is to retain the original import plugin's serialization formats and build an independent compatible export path. MeshParts and other instance types require compatibility handling; some Roblox-only properties and features may not survive serialization. No finished, tested combined plugin is being distributed from this repository at this time.

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

- The plugin is intended to disable its Export button for one second after a click.
- The API independently enforces a one-second per-user export cooldown.
- Repeated rapid export attempts trigger a 20-second server-side pause.
- Additional limits are 12 authenticated requests per user per minute and 30 per source IP per minute.
- Request nonces are one-use and expired nonce records are cleaned up.

## Security limitations

The API verifies that the submitted UserId belongs to the required group, but a UserId supplied by a client plugin is not cryptographic proof of identity. A modified client could forge the header. Timestamp freshness, nonces, group checks, and rate limits reduce casual abuse and replay, but they do not provide the same guarantee as a server-signed identity token. Do not put Cloudflare account tokens or database credentials in the plugin.

## Deployment notes

The public information site is intended to be hosted with GitHub Pages. The API is a separate Cloudflare Worker endpoint. A configured Worker subdomain does not by itself prove that every API route is reachable or that end-to-end plugin requests have been tested; those checks must be performed separately.

This is an independent community project and is not affiliated with or endorsed by Roblox or the F3X creators.
