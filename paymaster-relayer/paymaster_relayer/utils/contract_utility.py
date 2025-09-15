import json
from pathlib import Path
from typing import Any

from eth_account import Account
from eth_account.signers.local import LocalAccount
from web3 import Web3
from web3.middleware import SignAndSendRawMiddlewareBuilder


class ContractUtility:
    """
    Utility for contract interaction and ABI loading.

    Can be used in two modes:
    1. Full mode: Initialize with RPC URL and secret for signing transactions
    2. Read-only mode: Initialize with RPC URL only for building unsigned transactions
    """

    def __init__(self, rpc_url: str, secret: str = "") -> None:
        """
        Initialize the ContractUtility.

        Args:
            rpc_url: RPC URL for the network (required)
            secret: Private key for signing transactions (optional - if not provided, read-only mode)
        """
        if not rpc_url:
            raise ValueError("RPC URL is required")

        self.rpc_url = rpc_url
        self.w3 = Web3(Web3.HTTPProvider(self.rpc_url))

        # Add signing middleware only if secret is provided
        if secret:
            self._add_signing_middleware(secret)

    def _add_signing_middleware(self, secret: str) -> None:
        """
        Add signing middleware to the existing Web3 instance.

        Args:
            secret: Private key for signing transactions
        """
        if not secret:
            raise ValueError("Private key is required for signing transactions")

        account: LocalAccount = Account.from_key(secret)
        self.w3.middleware_onion.add(SignAndSendRawMiddlewareBuilder.build(account))
        self.w3.eth.default_account = account.address

    def get_contract_abi(self, contract_name: str) -> list[dict[str, Any]]:
        """Fetches ABI of the given contract from the contracts folder.

        Args:
            contract_name: Name of the contract (without .json extension)

        Returns:
            List of ABI dictionaries for the contract

        Raises:
            FileNotFoundError: If the contract file doesn't exist
            json.JSONDecodeError: If the contract file is invalid JSON
        """
        contract_path: Path = (
            Path(__file__).parent.parent.parent
            / "abis"
            / f"{contract_name}.json"
        ).resolve()

        with contract_path.open() as file:
            contract_data: dict[str, Any] = json.load(file)

        return contract_data["abi"]
