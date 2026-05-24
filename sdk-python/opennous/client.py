"""Nous Python SDK — the context layer for GTM agents.

A thin client of the v2 Context API. The agent reads engineered,
epistemics-tagged context and writes observations — it never overwrites.

    from opennous import NousClient

    client = NousClient(api_key="YOUR_API_KEY")
    ctx = client.get_context("sarah@acme.com", intent="follow_up")
    client.record("sarah@acme.com", [
        {"kind": "event", "property": "interaction.email_sent",
         "value": {"description": "intro email"}},
    ])
"""

from __future__ import annotations

import os
from typing import Any, Literal
from urllib.parse import quote

import httpx

DEFAULT_BASE_URL = "https://api.opennous.cloud"

ContextIntent = Literal[
    "draft_email", "follow_up", "meeting_prep", "call_prep", "account_review",
]


class NousError(Exception):
    def __init__(self, message: str, status: int, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class NousClient:
    """Nous Context API client.

    Usage::

        from opennous import NousClient

        client = NousClient(api_key="YOUR_API_KEY")

        # before acting on a person — engineered, intent-shaped context
        ctx = client.get_context("sarah@acme.com", intent="follow_up")

        # after an interaction — observe; Nous derives the updated facts
        client.record("sarah@acme.com", [
            {"kind": "event", "property": "interaction.email_sent",
             "value": {"description": "follow-up email"}},
        ])
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key or os.environ.get("NOUS_API_KEY")
        if not self._api_key:
            raise ValueError(
                "api_key is required. Pass it explicitly or set the NOUS_API_KEY environment variable."
            )
        self._base_url = (base_url or os.environ.get("NOUS_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self._client = httpx.Client(
            base_url=self._base_url,
            headers={"Authorization": f"Bearer {self._api_key}", "X-Nous-Client": "sdk-python"},
            timeout=timeout,
        )

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._handle(self._client.get(path, params=params))

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        return self._handle(self._client.post(path, json=body))

    @staticmethod
    def _handle(res: httpx.Response) -> dict[str, Any]:
        if not res.is_success:
            try:
                err = res.json()
                msg = err.get("message") or err.get("error") or res.reason_phrase
                code = err.get("error")
            except Exception:
                msg, code = res.reason_phrase, None
            raise NousError(msg, res.status_code, code)
        if res.status_code == 204:
            return {}
        return res.json()

    # ── Context API ───────────────────────────────────────────────────────────

    def get_context(
        self,
        focus: str,
        *,
        intent: ContextIntent = "account_review",
        budget_tokens: int | None = None,
    ) -> dict[str, Any]:
        """Engineered context for a task about one person or company.

        ``focus`` may be an email, LinkedIn URL, domain, entity UUID, or a name.
        A name that matches several people returns
        ``{"status": "ambiguous", "candidates": [...]}`` — pick one and re-call.
        """
        body: dict[str, Any] = {"focus": focus, "intent": intent}
        if budget_tokens is not None:
            body["budget_tokens"] = budget_tokens
        return self._post("/v2/context", body)

    def get_account(self, identifier: str) -> dict[str, Any]:
        """The full account record — every claim with its epistemics + the timeline."""
        return self._get(f"/v2/accounts/{quote(identifier, safe='')}")

    def record(self, focus: str, observations: list[dict[str, Any]]) -> dict[str, Any]:
        """Record what happened or what was learned. You observe — Nous derives.

        ``observations`` is a list of ``{kind, property, value, source?, ...}``.
        kind is "event" (an interaction) or "state" (a fact).
        """
        return self._post("/v2/observations", {"focus": focus, "observations": observations})

    def query(
        self,
        scope: dict[str, Any] | None = None,
        *,
        question: str | None = None,
    ) -> dict[str, Any]:
        """Retrieve and summarise a corpus of activity across many people.

        ``scope`` filters: kind, property (prefix), source, entity_id,
        since_days, limit.
        """
        body: dict[str, Any] = {"scope": scope or {}}
        if question is not None:
            body["question"] = question
        return self._post("/v2/query", body)

    def attention(self, *, limit: int | None = None) -> dict[str, Any]:
        """What needs attention across the workspace — accounts gone quiet,
        key facts decayed. Returns ranked decisions."""
        params = {"limit": limit} if limit is not None else None
        return self._get("/v2/attention", params=params)

    def verify(self, focus: str, prop: str) -> dict[str, Any]:
        """Re-check a claim before acting on it — the calibration check.

        ``prop`` is the property to re-check, e.g. "email" or "pipeline_stage".
        """
        return self._post("/v2/verify", {"focus": focus, "property": prop})

    def classify(
        self,
        *,
        emails: list[str] | None = None,
        linkedin_urls: list[str] | None = None,
    ) -> dict[str, Any]:
        """Cross-list cold-outbound dedup.

        Pass any combination of emails and LinkedIn URLs — useful BEFORE
        you scrape (Apollo's preview shows LinkedIn URLs for free; classify
        them against your workspace to know your overlap before paying for
        the email reveal). Each identifier is classified as ``net_new`` /
        ``engaged`` / ``recent`` / ``bounced`` / ``unsubscribed`` /
        ``suppressed``. Max 10,000 of each kind per call.

        Returns::

            {
              "results": [
                {"kind": "email"|"linkedin_url", "value": ..., "status": ...,
                 "entity_id"?: ..., "reason"?: ...}, ...
              ],
              "summary": {"net_new": int, "engaged": int, "recent": int,
                          "bounced": int, "unsubscribed": int, "suppressed": int,
                          "total": int}
            }
        """
        body: dict[str, Any] = {}
        if emails:        body["emails"] = emails
        if linkedin_urls: body["linkedin_urls"] = linkedin_urls
        if not body:
            raise ValueError("Pass at least one of `emails` or `linkedin_urls`.")
        return self._post("/v2/dedup", body)

    def get_workspace_facts(
        self,
        *,
        categories: list[str] | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """Workspace-level facts the user has recorded about THEIR OWN business.

        ICP, target market, product, pricing, competitors, playbooks —
        NOT facts about individual people/companies. The user's own playbook.
        Reach for this when answering questions about the user's business, not
        about a contact. Optional ``categories`` filter — omit for all.

        Returns::

            {
              "facts": [
                {"id": ..., "category": "ICP", "content": ..., "source": ...,
                 "recorded_at": ...}, ...
              ],
              "count": int,
              "by_category": {"ICP": 2, "Market": 1, ...}
            }
        """
        params: dict[str, Any] = {}
        if categories: params["categories"] = ",".join(categories)
        if limit is not None: params["limit"] = limit
        return self._get("/v2/workspace/facts", params=params)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self) -> "NousClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
