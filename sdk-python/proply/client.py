"""Proply Python SDK — contact memory for AI agents."""

from __future__ import annotations

import os
from typing import Any, Literal, Optional

import httpx

DEFAULT_BASE_URL = "https://api.goproply.com"

ActivityType = Literal[
    "email_sent", "email_reply",
    "call_held", "meeting_held",
    "linkedin_message", "linkedin_connected",
    "follow_up_sent", "proposal_sent",
    "website_visit", "content_download", "trial_started",
    "manual_note",
]

MemoryCategory = Literal[
    "ICP", "Product", "Pricing", "Market",
    "Competitors", "Team", "Patterns", "General",
]


class ProplyError(Exception):
    def __init__(self, message: str, status: int, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class ProplyClient:
    """
    Proply contact memory client.

    Usage::

        from proply import ProplyClient

        client = ProplyClient(api_key="YOUR_API_KEY")

        # Before acting on a contact
        contact = client.get_contact("sarah@acme.com")
        print(contact["summary"])

        # After an interaction
        client.track(email="sarah@acme.com", type="call_held", description="30 min discovery call")
        client.remember(email="sarah@acme.com", text="Concerned about Salesforce migration.")
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key or os.environ.get("PROPLY_API_KEY")
        if not self._api_key:
            raise ValueError(
                "api_key is required. Pass it explicitly or set the PROPLY_API_KEY environment variable."
            )
        self._base_url = (base_url or os.environ.get("PROPLY_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self._client = httpx.Client(
            base_url=self._base_url,
            headers={"Authorization": f"Bearer {self._api_key}", "X-Proply-Client": "sdk-python"},
            timeout=timeout,
        )

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        res = self._client.get(path, params=params)
        return self._handle(res)

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        res = self._client.post(path, json=body)
        return self._handle(res)

    def _patch(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        res = self._client.patch(path, json=body)
        return self._handle(res)

    def _delete(self, path: str) -> dict[str, Any]:
        res = self._client.delete(path)
        return self._handle(res)

    @staticmethod
    def _handle(res: httpx.Response) -> dict[str, Any]:
        if not res.is_success:
            try:
                err = res.json()
                msg = err.get("message") or err.get("error") or res.reason_phrase
                code = err.get("error")
            except Exception:
                msg = res.reason_phrase
                code = None
            raise ProplyError(msg, res.status_code, code)
        if res.status_code == 204:
            return {}
        return res.json()

    # ── Activity ──────────────────────────────────────────────────────────────

    def track(
        self,
        *,
        email: str | None = None,
        contact_id: str | None = None,
        type: ActivityType,
        description: str | None = None,
        occurred_at: str | None = None,
        source: str = "sdk",
    ) -> dict[str, Any]:
        """
        Log that something happened with a contact.
        Auto-creates the contact if they don't exist yet.

        :param email: Contact email address (required if contact_id not given)
        :param contact_id: Contact UUID (required if email not given)
        :param type: Activity type — e.g. "call_held", "email_sent"
        :param description: Brief summary of what happened
        :param occurred_at: ISO timestamp (defaults to now)
        :returns: { contact_id, activity_id, type, occurred_at, created_contact }
        """
        if not email and not contact_id:
            raise ValueError("Provide either email or contact_id")
        body: dict[str, Any] = {"type": type, "source": source}
        if email:        body["email"] = email
        if contact_id:   body["contact_id"] = contact_id
        if description:  body["description"] = description
        if occurred_at:  body["occurred_at"] = occurred_at
        return self._post("/v1/track", body)

    # ── Memory ────────────────────────────────────────────────────────────────

    def remember(
        self,
        *,
        email: str | None = None,
        contact_id: str | None = None,
        company_id: str | None = None,
        text: str,
        category: MemoryCategory = "General",
        source: str = "sdk",
    ) -> dict[str, Any]:
        """
        Store what was learned about a contact, company, or workspace.
        Pass a single sentence or a full transcript — AI extracts durable facts either way.
        Omit email, contact_id, and company_id to store workspace-level facts (ICP, product, market).

        :param text: The text to extract facts from
        :param category: Memory category (ICP, Product, Pricing, etc.)
        :returns: { stored: int, facts: list[{ id, content, written_at }] }
        """
        body: dict[str, Any] = {"text": text, "category": category, "source": source}
        if email:      body["email"] = email
        if contact_id: body["contact_id"] = contact_id
        if company_id: body["company_id"] = company_id
        return self._post("/v1/remember", body)

    def get_memories(
        self,
        *,
        category: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        """
        Load all workspace-level facts — ICP, product, pricing, market, competitive intel.
        Call before drafting outreach or any task requiring workspace context.

        :param category: Optional filter — ICP, Product, Pricing, Market, Competitors, Team, Patterns, General
        :param limit: Max facts to return (default 50, max 200)
        :returns: { memories: list[{ id, category, content, created_at }], total: int }
        """
        params: dict[str, Any] = {"limit": limit}
        if category: params["category"] = category
        return self._get("/v1/memories", params=params)

    def search(
        self,
        q: str,
        *,
        contact_id: Optional[str] = None,
        company_id: Optional[str] = None,
        limit: int = 10,
        threshold: Optional[float] = None,
    ) -> dict[str, Any]:
        """
        Semantic search across workspace memories.

        :param q: Search query
        :param contact_id: Scope search to one contact (uses lenient threshold 0.45)
        :param company_id: Scope search to one company
        :param limit: Max results (default 10)
        :param threshold: Override similarity threshold (0–1)
        :returns: { results: list, count: int }
        """
        body: dict[str, Any] = {"q": q, "limit": limit}
        if contact_id: body["contact_id"] = contact_id
        if company_id: body["company_id"] = company_id
        if threshold is not None: body["threshold"] = threshold
        return self._post("/v1/search", body)

    def delete_memory(self, memory_id: str) -> dict[str, Any]:
        """
        Soft-delete a workspace memory by UUID.
        Get the ID from get_memories(). Marks the fact inactive — won't appear in future reads.

        :param memory_id: Memory UUID
        :returns: { deleted: True, id, content }
        """
        from urllib.parse import quote
        return self._delete(f"/v1/memory/{quote(memory_id, safe='')}")

    # ── Contacts ──────────────────────────────────────────────────────────────

    def get_contact(self, identifier: str) -> dict[str, Any]:
        """
        Full contact profile — structured JSON.
        Returns identity, pipeline stage, AI summary, scores, channels, last 25 activities
        (with message body where available), facts, and company details.

        :param identifier: Email address or contact UUID
        :returns: Full contact profile dict
        """
        from urllib.parse import quote
        return self._get(f"/v1/contacts/{quote(identifier, safe='')}")

    def get_contact_activity(
        self,
        identifier: str,
        *,
        limit: int = 20,
        offset: int = 0,
        type: Optional[str] = None,
        before: Optional[str] = None,
        after: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Paginated activity history for a contact.
        Use when total_activities is high or you need to filter by type / date range.
        Each activity includes `body` (message text) where available.

        :param identifier: Email address or contact UUID
        :param limit: Number of activities to return (default 20, max 100)
        :param offset: Pagination offset
        :param type: Filter by type e.g. "linkedin_message", "email_received"
        :param before: ISO date — return activities before this date
        :param after: ISO date — return activities after this date
        :returns: { activities: list, total: int, limit: int, offset: int }
        """
        from urllib.parse import quote
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if type:   params["type"]   = type
        if before: params["before"] = before
        if after:  params["after"]  = after
        return self._get(f"/v1/contacts/{quote(identifier, safe='')}/activity", params=params)

    def list_contacts(
        self,
        *,
        stage: Optional[str] = None,
        search: Optional[str] = None,
        linkedin_url: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        List contacts, optionally filtered by pipeline stage or LinkedIn URL.

        :param stage: Pipeline stage filter — identified | aware | interested | evaluating | client
        :param search: Search query (name, email, or company)
        :param linkedin_url: Exact LinkedIn profile URL filter (normalized before matching)
        :param limit: Max contacts to return (default 20, max 100)
        :param offset: Pagination offset
        :returns: { contacts: list, total: int }
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if stage:        params["stage"] = stage
        if search:       params["search"] = search
        if linkedin_url: params["linkedin_url"] = linkedin_url
        return self._get("/v1/contacts", params=params)

    def create_contact(
        self,
        *,
        email: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        company: Optional[str] = None,
        job_title: Optional[str] = None,
        phone: Optional[str] = None,
        linkedin_url: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Create a new contact with full profile fields.
        email is required unless linkedin_url is provided.
        Returns 409 if a contact with that email or LinkedIn URL already exists.

        :param email: Email address (required if linkedin_url not given, must be unique)
        :param linkedin_url: LinkedIn profile URL (required if email not given, must be unique)
        :returns: { id, email, name, company, job_title, pipeline_stage, created_at }
        """
        if not email and not linkedin_url:
            raise ValueError("Provide either email or linkedin_url")
        body: dict[str, Any] = {}
        if email: body["email"] = email
        if first_name:   body["first_name"]   = first_name
        if last_name:    body["last_name"]     = last_name
        if company:      body["company"]       = company
        if job_title:    body["job_title"]     = job_title
        if phone:        body["phone"]         = phone
        if linkedin_url: body["linkedin_url"]  = linkedin_url
        if notes:        body["notes"]         = notes
        return self._post("/v1/contacts", body)

    def update_contact(
        self,
        identifier: str,
        *,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        company: Optional[str] = None,
        job_title: Optional[str] = None,
        phone: Optional[str] = None,
        linkedin_url: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Update one or more profile fields on an existing contact.
        Only provided fields are changed.

        :param identifier: Email address or contact UUID
        :returns: { id, email, name, company, job_title, pipeline_stage }
        """
        from urllib.parse import quote
        body: dict[str, Any] = {}
        if first_name   is not None: body["first_name"]   = first_name
        if last_name    is not None: body["last_name"]     = last_name
        if company      is not None: body["company"]       = company
        if job_title    is not None: body["job_title"]     = job_title
        if phone        is not None: body["phone"]         = phone
        if linkedin_url is not None: body["linkedin_url"]  = linkedin_url
        if notes        is not None: body["notes"]         = notes
        return self._patch(f"/v1/contacts/{quote(identifier, safe='')}", body)

    def delete_contact(self, identifier: str) -> dict[str, Any]:
        """
        Permanently delete a contact and all their data — activities and memories.
        Cannot be undone. Pass email address or contact UUID.

        :param identifier: Email address or contact UUID
        :returns: { deleted: True, contact_id, email }
        """
        from urllib.parse import quote
        return self._delete(f"/v1/contacts/{quote(identifier, safe='')}")

    # ── Company ───────────────────────────────────────────────────────────────

    def get_company(self, company_id: str) -> dict[str, Any]:
        """
        Full token-budgeted company profile.
        Returns org details + all contacts + company facts.

        :param company_id: Company UUID
        :returns: Full company profile dict
        """
        from urllib.parse import quote
        return self._get(f"/v1/company/{quote(company_id, safe='')}")

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self) -> "ProplyClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
