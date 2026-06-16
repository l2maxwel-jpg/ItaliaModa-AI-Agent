"""
FastAPI proxy that forwards /api/* requests to the Node.js Express server
running on localhost:3000. This adapts the original Vite + Express app
(ItaliaModa AI Agent) to Emergent's required architecture:
  - Backend (this) listens on 0.0.0.0:8001 and handles /api/*
  - Frontend (Node Express + Vite middleware) listens on 0.0.0.0:3000
"""
import os
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv

load_dotenv()

NODE_UPSTREAM = os.environ.get("NODE_UPSTREAM_URL", "http://localhost:3000")
TIMEOUT_SECONDS = 600.0  # 10 minutes for long Gemini image analysis

app = FastAPI(title="ItaliaModa API Proxy")

# Shared async HTTP client (connection pooling)
client = httpx.AsyncClient(timeout=TIMEOUT_SECONDS)


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await client.aclose()


@app.get("/api/health")
async def health() -> dict:
    """Lightweight health check (not proxied)."""
    return {"status": "ok", "upstream": NODE_UPSTREAM}


HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
    "content-encoding",
}


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
)
async def proxy(path: str, request: Request) -> Response:
    upstream_url = f"{NODE_UPSTREAM}/api/{path}"

    # Forward headers (strip hop-by-hop)
    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP
    }

    body = await request.body()

    upstream_response = await client.request(
        request.method,
        upstream_url,
        headers=headers,
        content=body,
        params=request.query_params,
    )

    # Build response headers (strip hop-by-hop)
    resp_headers = {
        k: v
        for k, v in upstream_response.headers.items()
        if k.lower() not in HOP_BY_HOP
    }

    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=resp_headers,
        media_type=upstream_response.headers.get("content-type"),
    )
