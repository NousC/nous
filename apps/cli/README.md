# @opennous/cli

Nous CLI — install Nous event tracking into your app, plus terminal access to the Context API.

## Quick start

```bash
# in your project root
npx -y @opennous/cli@latest install
```

`nous install` detects your stack (Next.js, Node, Python), writes a small `nous.js` (or `nous.py`) module with three helpers, and updates your `.env`:

- **`trackSignup({email, ...})`** — fires `interaction.signed_up` + initial `state.stage`
- **`handleStripeEvent(event, {customerEmail})`** — fires `interaction.subscription_started / updated / canceled` and flips `state.stage` (Customer / Churned)
- **`track(focus, property, value)`** — escape hatch for any other event

The generated module is plain code you own. Read it, edit it, or delete it.

## Other commands

```bash
nous auth login --key <your-key>     # save your API key
nous context <email>                  # engineered context for a person
nous account <email>                  # full record with epistemics + timeline
nous record <email> --property X --value Y
nous query --property stage --value Customer
nous attention                        # surface what changed recently
nous verify <email> <property>        # confirm a claim is current
```

Run `nous --help` for the full list.

## Auth

`NOUS_API_KEY` env var, or `nous auth login --key <key>`. Mint a key at [app.opennous.cloud](https://app.opennous.cloud) → Settings → API Keys.

## Self-hosting

Set `NOUS_API_URL` to your own deployment.

## License

AGPL-3.0
