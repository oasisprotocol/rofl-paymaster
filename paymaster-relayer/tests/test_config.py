"""
Tests for config parsing of comma-delimited RPC URLs.

Tests the parsing of SOURCE_RPC_URLS environment variable.
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest


class TestParseRpcUrls:
    """Tests for parse_rpc_urls function."""

    def test_single_url(self, monkeypatch):
        """Parse a single URL with no commas."""
        from paymaster_relayer.config import parse_rpc_urls

        monkeypatch.setenv("SOURCE_RPC_URLS", "https://rpc1.example.com")

        urls = parse_rpc_urls()

        assert urls == ["https://rpc1.example.com"]

    def test_multiple_urls(self, monkeypatch):
        """Parse comma-separated URLs."""
        from paymaster_relayer.config import parse_rpc_urls

        monkeypatch.setenv(
            "SOURCE_RPC_URLS",
            "https://rpc1.example.com,https://rpc2.example.com,https://rpc3.example.com",
        )

        urls = parse_rpc_urls()

        assert urls == [
            "https://rpc1.example.com",
            "https://rpc2.example.com",
            "https://rpc3.example.com",
        ]

    def test_whitespace_handling(self, monkeypatch):
        """Spaces around commas are trimmed."""
        from paymaster_relayer.config import parse_rpc_urls

        monkeypatch.setenv(
            "SOURCE_RPC_URLS",
            "  https://rpc1.example.com , https://rpc2.example.com  ",
        )

        urls = parse_rpc_urls()

        assert urls == [
            "https://rpc1.example.com",
            "https://rpc2.example.com",
        ]

    def test_empty_entries_filtered(self, monkeypatch):
        """Empty entries from consecutive/trailing commas are filtered out."""
        from paymaster_relayer.config import parse_rpc_urls

        monkeypatch.setenv(
            "SOURCE_RPC_URLS",
            "https://rpc1.example.com,,https://rpc2.example.com,",
        )

        urls = parse_rpc_urls()

        assert urls == [
            "https://rpc1.example.com",
            "https://rpc2.example.com",
        ]

    def test_error_when_not_set(self, monkeypatch):
        """Error when SOURCE_RPC_URLS environment variable is missing."""
        from paymaster_relayer.config import parse_rpc_urls

        monkeypatch.delenv("SOURCE_RPC_URLS", raising=False)

        with pytest.raises(ValueError, match=r"missing or empty"):
            parse_rpc_urls()

    def test_error_when_all_empty(self, monkeypatch):
        """Error when value is only commas/whitespace."""
        from paymaster_relayer.config import parse_rpc_urls

        monkeypatch.setenv("SOURCE_RPC_URLS", ",,")

        with pytest.raises(ValueError, match=r"missing or empty"):
            parse_rpc_urls()
