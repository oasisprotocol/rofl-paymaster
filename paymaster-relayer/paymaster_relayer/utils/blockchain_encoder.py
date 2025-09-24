"""
Blockchain encoding utilities for ROFL Relayer.

This module provides RLP encoding and serialization utilities for Ethereum
blockchain data structures, supporting multiple hardfork versions.
"""

import logging

import rlp
from hexbytes import HexBytes
from web3 import Web3
from web3.types import BlockData, TxReceipt

logger = logging.getLogger(__name__)


class BlockchainEncoder:
    """Utilities for encoding blockchain data structures."""

    @staticmethod
    def to_bytes_safe(value: HexBytes | bytes | str) -> bytes:
        """
        Safely convert value to bytes, handling HexBytes, bytes, and hex strings.

        Args:
            value: Value to convert (HexBytes, bytes, or hex string)

        Returns:
            Bytes representation
        """
        if isinstance(value, HexBytes):
            return bytes(value)
        elif isinstance(value, bytes):
            return value
        else:
            return Web3.to_bytes(hexstr=value)

    @staticmethod
    def encode_transaction_index(tx_index: int) -> bytes:
        """
        Encode a transaction index according to Ethereum RLP rules.

        Special case: Transaction index 0 encodes to empty bytes per Ethereum spec.
        All other indices encode normally as integers.

        Args:
            tx_index: Transaction index to encode

        Returns:
            RLP-encoded transaction index
        """
        if tx_index == 0:
            return rlp.encode(b"")
        else:
            return rlp.encode(tx_index)

    @staticmethod
    def encode_receipt(receipt: TxReceipt) -> bytes:
        """
        RLP encode a transaction receipt with proper type handling.

        Handles both legacy (type 0) and typed transactions (EIP-2718).

        Args:
            receipt: Transaction receipt to encode

        Returns:
            RLP encoded receipt with type prefix if needed
        """
        # Get transaction type (0 for legacy, 2 for EIP-1559, etc.)
        tx_type = int(receipt.get("type", 0))

        # Encode receipt fields
        status = b"\x01" if receipt["status"] == 1 else b""
        cumulative_gas = receipt["cumulativeGasUsed"]
        logs_bloom = receipt["logsBloom"]

        # Encode logs
        encoded_logs = []
        for log in receipt["logs"]:
            encoded_log = [
                BlockchainEncoder.to_bytes_safe(log["address"]),
                [BlockchainEncoder.to_bytes_safe(topic) for topic in log["topics"]],
                BlockchainEncoder.to_bytes_safe(log["data"]),
            ]
            encoded_logs.append(encoded_log)

        # Create receipt tuple
        receipt_data = [status, cumulative_gas, logs_bloom, encoded_logs]
        encoded = rlp.encode(receipt_data)

        # Add transaction type prefix for typed transactions
        if tx_type == 0:
            return encoded
        else:
            # For typed transactions, prepend the type byte
            return bytes([tx_type]) + encoded

    @staticmethod
    def encode_block_header_legacy(block: BlockData) -> list:
        """
        Encode legacy block header fields (pre-London).

        Args:
            block: Block data containing header fields

        Returns:
            List of encoded header fields (0-14)
        """
        return [
            BlockchainEncoder.to_bytes_safe(block["parentHash"]),  # 0
            BlockchainEncoder.to_bytes_safe(block["sha3Uncles"]),  # 1
            BlockchainEncoder.to_bytes_safe(block["miner"]),  # 2
            BlockchainEncoder.to_bytes_safe(block["stateRoot"]),  # 3
            BlockchainEncoder.to_bytes_safe(block["transactionsRoot"]),  # 4
            BlockchainEncoder.to_bytes_safe(block["receiptsRoot"]),  # 5
            BlockchainEncoder.to_bytes_safe(block["logsBloom"]),  # 6
            block["difficulty"],  # 7 - RLP encoder handles ints
            block["number"],  # 8
            block["gasLimit"],  # 9
            block["gasUsed"],  # 10
            block["timestamp"],  # 11
            BlockchainEncoder.to_bytes_safe(block["extraData"]),  # 12
            BlockchainEncoder.to_bytes_safe(block["mixHash"]),  # 13
            BlockchainEncoder.to_bytes_safe(block["nonce"]),  # 14
        ]

    @staticmethod
    def add_london_fields(header_fields: list, block: BlockData) -> None:
        """
        Add London hardfork fields (EIP-1559).

        Args:
            header_fields: List to append fields to
            block: Block data containing header fields
        """
        # Field 15: baseFeePerGas (London, EIP-1559)
        if "baseFeePerGas" in block and block["baseFeePerGas"] is not None:
            header_fields.append(block["baseFeePerGas"])

    @staticmethod
    def add_shanghai_fields(header_fields: list, block: BlockData) -> None:
        """
        Add Shanghai hardfork fields (EIP-4895).

        Args:
            header_fields: List to append fields to
            block: Block data containing header fields
        """
        # Field 16: withdrawalsRoot (Shanghai, EIP-4895)
        if "withdrawalsRoot" in block and block["withdrawalsRoot"] is not None:
            header_fields.append(
                BlockchainEncoder.to_bytes_safe(block["withdrawalsRoot"])
            )

    @staticmethod
    def add_cancun_fields(header_fields: list, block: BlockData) -> None:
        """
        Add Cancun hardfork fields (EIP-4844, EIP-4788).

        Args:
            header_fields: List to append fields to
            block: Block data containing header fields
        """
        # Field 17: blobGasUsed (Cancun, EIP-4844)
        if "blobGasUsed" in block and block["blobGasUsed"] is not None:
            header_fields.append(block["blobGasUsed"])

        # Field 18: excessBlobGas (Cancun, EIP-4844)
        if "excessBlobGas" in block and block["excessBlobGas"] is not None:
            header_fields.append(block["excessBlobGas"])

        # Field 19: parentBeaconBlockRoot (Cancun, EIP-4788)
        if (
            "parentBeaconBlockRoot" in block
            and block["parentBeaconBlockRoot"] is not None
        ):
            header_fields.append(
                BlockchainEncoder.to_bytes_safe(block["parentBeaconBlockRoot"])
            )

    @staticmethod
    def add_prague_fields(header_fields: list, block: BlockData) -> None:
        """
        Add Prague hardfork fields (EIP-7685).

        Args:
            header_fields: List to append fields to
            block: Block data containing header fields
        """
        # Field 20: requestsRoot (Prague/Cancun, EIP-7685)
        requests_field = block.get("requestsRoot") or block.get("requestsHash")
        if requests_field is not None:
            header_fields.append(BlockchainEncoder.to_bytes_safe(requests_field))

    @staticmethod
    def encode_block_header(block: BlockData) -> str:
        """
        Serialize block header to match Ethereum block encoding.

        Handles all hardfork fields up to Prague (EIP-7685).
        Fields are added conditionally based on their presence in the block data.

        Args:
            block: Block data from Web3

        Returns:
            Hex string of serialized block header
        """
        # Start with legacy fields (always present)
        header_fields = BlockchainEncoder.encode_block_header_legacy(block)

        # Add hardfork-specific fields in order
        BlockchainEncoder.add_london_fields(header_fields, block)
        BlockchainEncoder.add_shanghai_fields(header_fields, block)
        BlockchainEncoder.add_cancun_fields(header_fields, block)
        BlockchainEncoder.add_prague_fields(header_fields, block)

        # RLP encode the header
        encoded = rlp.encode(header_fields)

        # Verify hash matches (optional validation)
        if logger.isEnabledFor(logging.DEBUG):
            BlockchainEncoder._verify_block_hash(encoded, block, header_fields)

        return Web3.to_hex(encoded)

    @staticmethod
    def _verify_block_hash(
        encoded: bytes, block: BlockData, header_fields: list
    ) -> None:
        """
        Verify the encoded block header hash matches the expected hash.

        Args:
            encoded: RLP encoded block header
            block: Original block data
            header_fields: List of header fields for debugging
        """
        calculated_hash = Web3.keccak(encoded)
        block_hash_bytes = BlockchainEncoder.to_bytes_safe(block["hash"])

        if calculated_hash != block_hash_bytes:
            logger.warning(
                f"Header hash mismatch. Calculated: {Web3.to_hex(calculated_hash)}, "
                f"Expected: {Web3.to_hex(block_hash_bytes)}"
            )
            logger.warning(
                "This may be due to network-specific encoding or missing fields."
            )
            logger.debug(f"Block fields present: {list(block.keys())}")
            logger.debug(f"Header has {len(header_fields)} fields")

            # Log hardfork field presence for debugging
            logger.debug(
                f"Hardfork fields - baseFeePerGas: {block.get('baseFeePerGas')}, "
                f"withdrawalsRoot: {block.get('withdrawalsRoot')}, "
                f"blobGasUsed: {block.get('blobGasUsed')}, "
                f"excessBlobGas: {block.get('excessBlobGas')}, "
                f"parentBeaconBlockRoot: {block.get('parentBeaconBlockRoot')}, "
                f"requestsRoot: {block.get('requestsRoot')}"
            )
