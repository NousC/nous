# opennous · Python SDK

Official Python SDK for the [Nous](https://opennous.cloud) API — GTM data infrastructure for agents.

## Install

```bash
pip install opennous
```

## Usage

```python
from opennous import NousClient

client = NousClient(api_key="your-api-key")

# Get full contact profile before acting
contact = client.get_contact("sarah@acme.com")
print(contact["summary"])

# Log an interaction
client.track(email="sarah@acme.com", type="call_held", description="30 min discovery call")

# Store a fact
client.remember(email="sarah@acme.com", text="Concerned about Salesforce migration and Q3 budget.")

# Store workspace-level facts
client.remember(text="ICP: technical founders of AI sales tools, 2-20 people.", category="ICP")

# Semantic search
results = client.search("budget concerns")
```

## Auth

Set your API key via env var or pass directly:

```bash
export NOUS_API_KEY=your-api-key
```

```python
client = NousClient()  # picks up NOUS_API_KEY automatically
```

## Docs

Full API reference: [docs.opennous.cloud](https://docs.opennous.cloud)

## License

MIT
