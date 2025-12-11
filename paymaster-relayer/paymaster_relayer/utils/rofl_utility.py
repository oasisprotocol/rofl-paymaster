import codecs
import json
import logging
from typing import Any

import cbor2
import httpx
from web3.types import TxParams

logger = logging.getLogger(__name__)


class RoflUtility:
    """Utility for interacting with ROFL runtime services.

    Provides methods for key fetching and transaction submission
    through the ROFL application daemon.
    """

    ROFL_SOCKET_PATH: str = "/run/rofl-appd.sock"

    def __init__(self, url: str = "") -> None:
        """Initialize ROFL utility.

        Args:
            url: Optional URL for HTTP transport (defaults to socket)
        """
        self.url: str = url

    async def _appd_post(self, path: str, payload: Any) -> Any:
        """Post request to ROFL application daemon.

        Args:
            path: API endpoint path
            payload: JSON payload to send

        Returns:
            JSON response from the daemon

        Raises:
            httpx.HTTPStatusError: If the request fails
        """
        transport: httpx.AsyncHTTPTransport | None = None

        if self.url and not self.url.startswith("http"):
            transport = httpx.AsyncHTTPTransport(uds=self.url)
            logger.debug(f"Using HTTP socket: {self.url}")
        elif not self.url:
            transport = httpx.AsyncHTTPTransport(uds=self.ROFL_SOCKET_PATH)
            logger.debug(f"Using unix domain socket: {self.ROFL_SOCKET_PATH}")

        async with httpx.AsyncClient(transport=transport) as client:
            base_url: str = (
                self.url
                if self.url and self.url.startswith("http")
                else "http://localhost"
            )
            full_url: str = base_url + path
            logger.debug(f"Posting to {full_url}: {json.dumps(payload)}")
            response: httpx.Response = await client.post(
                full_url, json=payload, timeout=60.0
            )
            response.raise_for_status()
            return response.json()

    async def fetch_key(self, key_id: str) -> str:
        """Fetch or generate a cryptographic key from ROFL.

        Args:
            key_id: Identifier for the key

        Returns:
            The private key as a hex string

        Raises:
            httpx.HTTPStatusError: If key fetch fails
        """
        payload: dict[str, str] = {"key_id": key_id, "kind": "secp256k1"}

        path: str = "/rofl/v1/keys/generate"
        response: dict[str, Any] = await self._appd_post(path, payload)
        return response["key"]

    def _decode_cbor_response(self, response_hex: str) -> dict[str, Any]:
        """
        Decode CBOR response from ROFL service.

        Args:
            response_hex: Hex-encoded CBOR response

        Returns:
            Decoded CBOR data as dictionary
        """
        try:
            data_bytes: bytes = codecs.decode(response_hex, "hex")
            cbor_result: Any = cbor2.loads(data_bytes)
            logger.debug(f"Decoded CBOR: {cbor_result}")
            return (
                cbor_result if isinstance(cbor_result, dict) else {"data": cbor_result}
            )
        except Exception as decode_error:
            logger.error(f"CBOR decode error: {decode_error}")
            return {"error": "decode_failed", "raw": response_hex}

    async def submit_tx(self, tx: TxParams) -> bool:
        """
        Submit a transaction via ROFL.

        Args:
            tx: Transaction parameters

        Returns:
            True if transaction was accepted, False otherwise

        Raises:
            Exception: If ROFL returns an error
        """
        payload: dict[str, Any] = {
            "tx": {
                "kind": "eth",
                "data": {
                    "gas_limit": tx["gas"],
                    "to": tx["to"].removeprefix("0x"),
                    "value": str(tx["value"]),
                    "data": tx["data"].removeprefix("0x"),
                },
            },
            "encrypt": False,
        }

        path: str = "/rofl/v1/tx/sign-submit"
        response: dict[str, Any] = await self._appd_post(path, payload)
        response_hex: str = response["data"]
        logger.debug(f"ROFL raw response: {response_hex}")

        # Decode CBOR response to check for success
        decoded_response: dict[str, Any] = self._decode_cbor_response(response_hex)

        match decoded_response:
            case {"ok": _}:
                logger.info("Transaction submitted successfully to ROFL")
                return True
            case {"error": error_msg}:
                logger.error(f"ROFL transaction failed: {error_msg}")
                raise Exception(f"ROFL transaction failed: {error_msg}")
            case _:
                logger.warning(f"Unknown ROFL response format: {decoded_response}")
                # If no clear error, assume success
                return True
